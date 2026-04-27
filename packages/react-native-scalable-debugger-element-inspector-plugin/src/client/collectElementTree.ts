import type {
  ElementInspectorGetTreeParams,
  ElementInspectorNode,
  ElementInspectorSnapshot,
  JSONValue,
} from '../shared/protocol';
import { UIManager } from 'react-native';
import {
  getReactDevToolsFiberRoots,
  type ReactFiberLike,
} from './instrumentation/reactDevToolsHook';

const MAX_DEPTH = 80;
const MAX_NODES = 3000;
const MAX_PROP_KEYS = 40;
const MAX_ARRAY_ITEMS = 40;
const MAX_STRING_LENGTH = 300;
const MAX_PROP_DEPTH = 2;
const MAX_STYLE_DEPTH = 8;

interface CollectContext {
  visited: Set<ReactFiberLike>;
  warnings: Set<string>;
  nodeCount: number;
}

export function collectElementTree(
  request: ElementInspectorGetTreeParams
): Promise<ElementInspectorSnapshot> {
  const capturedAt = Date.now();
  const roots = getReactDevToolsFiberRoots();

  if (roots.length === 0) {
    return Promise.resolve({
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      capturedAt,
      status: 'unsupported',
      reason:
        'React DevTools global hook did not expose any Fiber roots in this runtime.',
    });
  }

  const context: CollectContext = {
    visited: new Set(),
    warnings: new Set([
      'Layout bounds were measured from the native inspector path and may vary across React Native versions.',
    ]),
    nodeCount: 0,
  };

  return Promise.all(
    roots.map(async (root, index) => {
      const rootFiber = root.current?.child ?? root.current ?? null;
      return collectSiblings(rootFiber, `root.${index}`, 0, context);
    })
  ).then((childrenGroups) => {
    const children = childrenGroups.flat();

    if (children.length === 0) {
      return {
        requestId: request.requestId,
        requestedAt: request.requestedAt,
        capturedAt,
        status: 'unsupported',
        reason: 'React Fiber roots were present, but no element nodes were found.',
        warnings: Array.from(context.warnings),
      };
    }

    return {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      capturedAt,
      status: 'ok',
      root:
        children.length === 1
          ? children[0]
          : {
              id: 'root',
              type: 'Root',
              displayName: 'Root',
              children,
            },
      warnings: Array.from(context.warnings),
    };
  });
}

async function collectSiblings(
  fiber: ReactFiberLike | null,
  path: string,
  depth: number,
  context: CollectContext
): Promise<ElementInspectorNode[]> {
  const fibers: ReactFiberLike[] = [];
  let cursor: ReactFiberLike | null | undefined = fiber;
  while (cursor) {
    fibers.push(cursor);
    cursor = cursor.sibling;
  }

  const nodes = await Promise.all(
    fibers.map((item, index) =>
      fiberToNode(item, `${path}.${index}`, depth, context)
    )
  );

  return nodes.filter((node): node is ElementInspectorNode => node != null);
}

async function fiberToNode(
  fiber: ReactFiberLike,
  path: string,
  depth: number,
  context: CollectContext
): Promise<ElementInspectorNode | null> {
  if (context.visited.has(fiber)) {
    return null;
  }
  context.visited.add(fiber);

  if (depth > MAX_DEPTH) {
    context.warnings.add(`Tree traversal stopped at max depth ${MAX_DEPTH}.`);
    return null;
  }

  if (context.nodeCount >= MAX_NODES) {
    context.warnings.add(`Tree traversal stopped at max node count ${MAX_NODES}.`);
    return null;
  }

  context.nodeCount += 1;
  const displayName = getDisplayName(fiber);
  const layoutTarget = findInspectableHostFiber(fiber);
  const rawProps = getProps(layoutTarget ?? fiber);
  const props = sanitizeProps(rawProps);
  const [children, layout] = await Promise.all([
    collectSiblings(fiber.child ?? null, path, depth + 1, context),
    measureLayout(layoutTarget),
  ]);
  const primitiveText = fiber.tag === 6 ? getDirectFiberText(fiber) : undefined;

  const node: ElementInspectorNode = {
    id: path,
    type: displayName,
    displayName,
  };

  if (primitiveText) {
    node.text = truncateString(primitiveText);
  }
  if (props && Object.keys(props).length > 0) {
    node.props = props;
  }
  if (layout) {
    node.layout = layout;
  }
  if (fiber._debugSource) {
    node.source = {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber,
      columnNumber: fiber._debugSource.columnNumber,
    };
  }
  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

function getProps(
  fiber: ReactFiberLike
): Record<string, unknown> | undefined {
  const props = fiber.memoizedProps ?? fiber.pendingProps;
  return props && typeof props === 'object' && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : undefined;
}

function findInspectableHostFiber(
  fiber: ReactFiberLike | null | undefined
): ReactFiberLike | null {
  if (!fiber) {
    return null;
  }

  if (isHostFiber(fiber)) {
    return fiber;
  }

  let child = fiber.child ?? null;
  while (child) {
    const hostFiber = findInspectableHostFiber(child);
    if (hostFiber) {
      return hostFiber;
    }
    child = child.sibling ?? null;
  }

  return null;
}

async function measureLayout(
  fiber: ReactFiberLike | null
): Promise<ElementInspectorNode['layout'] | undefined> {
  const reactTag = getReactTag(fiber?.stateNode);

  if (reactTag == null) {
    return undefined;
  }

  if (typeof UIManager.measure !== 'function') {
    return undefined;
  }

  return new Promise((resolve) => {
    try {
      UIManager.measure(reactTag, (x, y, width, height, pageX, pageY) => {
        resolve({
          x: Number.isFinite(pageX) ? pageX : x,
          y: Number.isFinite(pageY) ? pageY : y,
          width,
          height,
        });
      });
    } catch {
      resolve(undefined);
    }
  });
}

function getReactTag(
  hostInstance: unknown
): number | null {
  if (!hostInstance || typeof hostInstance !== 'object') {
    return null;
  }

  const directTag = getObjectValue(hostInstance, '_nativeTag');
  if (typeof directTag === 'number') {
    return directTag;
  }

  const canonical = getObjectValue(hostInstance, 'canonical');
  const canonicalTag = getObjectValue(canonical, 'nativeTag');
  if (typeof canonicalTag === 'number') {
    return canonicalTag;
  }

  const node = getObjectValue(hostInstance, 'node');
  const nodeTag = getObjectValue(node, '_nativeTag');
  if (typeof nodeTag === 'number') {
    return nodeTag;
  }

  const canonicalNode = getObjectValue(canonical, 'node');
  const canonicalNodeTag = getObjectValue(canonicalNode, '_nativeTag');
  if (typeof canonicalNodeTag === 'number') {
    return canonicalNodeTag;
  }

  return null;
}

function isHostFiber(fiber: ReactFiberLike): boolean {
  return fiber.tag === 5 || fiber.tag === 6;
}

function getDisplayName(fiber: ReactFiberLike): string {
  const type = fiber.elementType ?? fiber.type;
  return getDisplayNameFromType(type) ?? getDisplayNameFromTag(fiber.tag);
}

function getDisplayNameFromType(type: unknown): string | null {
  if (typeof type === 'string') {
    return type;
  }

  if (typeof type === 'function') {
    return getNamedValue(type, 'displayName') ?? type.name ?? 'Anonymous';
  }

  if (!type || typeof type !== 'object') {
    return null;
  }

  const displayName = getNamedValue(type, 'displayName');
  if (displayName) {
    return displayName;
  }

  const name = getNamedValue(type, 'name');
  if (name) {
    return name;
  }

  const nestedType = getObjectValue(type, 'type');
  if (nestedType && nestedType !== type) {
    const nestedName = getDisplayNameFromType(nestedType);
    if (nestedName) {
      return nestedName;
    }
  }

  const render = getObjectValue(type, 'render');
  if (render) {
    const renderName = getDisplayNameFromType(render);
    if (renderName) {
      return renderName;
    }
  }

  return null;
}

function getDisplayNameFromTag(tag: number | undefined): string {
  switch (tag) {
    case 3:
      return 'Root';
    case 5:
      return 'HostComponent';
    case 6:
      return 'Text';
    case 7:
      return 'Fragment';
    case 11:
      return 'ForwardRef';
    case 14:
    case 15:
      return 'Memo';
    default:
      return tag == null ? 'Unknown' : `FiberTag${tag}`;
  }
}

function sanitizeProps(
  props: Record<string, unknown> | undefined
): Record<string, JSONValue> | undefined {
  if (!props) {
    return undefined;
  }

  const sanitized: Record<string, JSONValue> = {};
  for (const key of Object.keys(props).slice(0, MAX_PROP_KEYS)) {
    if (key === 'children' || key === 'ref' || key === 'key') {
      continue;
    }

    const value =
      key === 'style'
        ? sanitizeStyleValue(props[key])
        : sanitizeValue(props[key], 0);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeStyleValue(value: unknown): JSONValue | undefined {
  return sanitizeValue(value, 0, MAX_STYLE_DEPTH, new WeakSet<object>());
}

function sanitizeValue(
  value: unknown,
  depth: number,
  maxDepth = MAX_PROP_DEPTH,
  seen?: WeakSet<object>
): JSONValue | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (depth >= maxDepth) {
    return '[Object]';
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, maxDepth, seen))
      .filter((item): item is JSONValue => item !== undefined);
  }
  if (typeof value === 'object') {
    if (seen?.has(value)) {
      return '[Circular]';
    }
    seen?.add(value);

    const output: Record<string, JSONValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).slice(
      0,
      MAX_PROP_KEYS
    )) {
      if (key.startsWith('_')) {
        continue;
      }
      const childValue = sanitizeValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
        maxDepth,
        seen
      );
      if (childValue !== undefined) {
        output[key] = childValue;
      }
    }
    seen?.delete(value);
    return output;
  }

  return undefined;
}

function getPrimitiveText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(getPrimitiveText)
      .filter((part): part is string => typeof part === 'string');
    return parts.length > 0 ? parts.join('') : undefined;
  }
  return undefined;
}

function getDirectFiberText(fiber: ReactFiberLike): string | undefined {
  const props = fiber.memoizedProps ?? fiber.pendingProps;

  if (typeof props === 'string' || typeof props === 'number') {
    return String(props);
  }

  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const children = (props as Record<string, unknown>).children;
    const text = getPrimitiveText(children);
    if (text) {
      return text;
    }
  }

  const stateNodeText = getObjectValue(fiber.stateNode, 'text');
  if (typeof stateNodeText === 'string' || typeof stateNodeText === 'number') {
    return String(stateNodeText);
  }

  return undefined;
}

function getNamedValue(object: unknown, key: string): string | null {
  const value = getObjectValue(object, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getObjectValue(object: unknown, key: string): unknown {
  return object && typeof object === 'object'
    ? (object as Record<string, unknown>)[key]
    : undefined;
}

function truncateString(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...`
    : value;
}
