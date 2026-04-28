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

const MAX_PROP_KEYS = 40;
const MAX_ARRAY_ITEMS = 40;
const MAX_STRING_LENGTH = 300;
const MAX_PROP_DEPTH = 2;
const MAX_STYLE_DEPTH = 8;
const IGNORED_ELEMENT_NAMES = new Set([
  'DebuggingOverlay',
  'LogBoxStateSubscription',
]);

interface CollectContext {
  visited: Set<ReactFiberLike>;
  warnings: Set<string>;
}

type PendingLayoutNode = Omit<ElementInspectorNode, 'children'> & {
  children?: PendingLayoutNode[];
  layoutTarget?: ReactFiberLike | null;
};

type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
  pageX: number,
  pageY: number
) => void;

interface MeasurableHostInstance {
  measure: (callback: MeasureCallback) => void;
}

type LegacyMeasure = (node: number, callback: MeasureCallback) => void;

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
  _depth: number,
  context: CollectContext
): Promise<ElementInspectorNode[]> {
  const rootFibers = getSiblingFibers(fiber);
  const roots: PendingLayoutNode[] = [];
  const stack: Array<{
    fiber: ReactFiberLike;
    parentChildren: PendingLayoutNode[];
    path: string;
  }> = [];
  const layoutTasks: Promise<void>[] = [];
  const createdNodes: PendingLayoutNode[] = [];

  for (let index = rootFibers.length - 1; index >= 0; index -= 1) {
    stack.push({
      fiber: rootFibers[index],
      parentChildren: roots,
      path: `${path}.${index}`,
    });
  }

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (context.visited.has(item.fiber)) {
      continue;
    }

    const displayName = getDisplayName(item.fiber);
    if (shouldIgnoreElement(displayName)) {
      context.visited.add(item.fiber);
      pushChildFibers(stack, item.fiber, item.parentChildren, item.path);
      continue;
    }

    const node = fiberToNode(item.fiber, item.path, context);
    if (!node) {
      continue;
    }

    item.parentChildren.push(node);
    createdNodes.push(node);
    layoutTasks.push(
      measureLayout(node.layoutTarget ?? null).then((layout) => {
        if (layout) {
          node.layout = layout;
        }
        delete node.layoutTarget;
      })
    );

    const childFibers = getSiblingFibers(item.fiber.child ?? null);
    if (childFibers.length > 0) {
      const children: PendingLayoutNode[] = [];
      node.children = children;
      pushFibers(stack, childFibers, children, item.path);
    }
  }

  await Promise.all(layoutTasks);

  for (const node of createdNodes) {
    if (node.children && node.children.length === 0) {
      delete node.children;
    }
  }

  return roots;
}

function pushChildFibers(
  stack: Array<{
    fiber: ReactFiberLike;
    parentChildren: PendingLayoutNode[];
    path: string;
  }>,
  fiber: ReactFiberLike,
  parentChildren: PendingLayoutNode[],
  path: string
): void {
  pushFibers(stack, getSiblingFibers(fiber.child ?? null), parentChildren, path);
}

function pushFibers(
  stack: Array<{
    fiber: ReactFiberLike;
    parentChildren: PendingLayoutNode[];
    path: string;
  }>,
  fibers: ReactFiberLike[],
  parentChildren: PendingLayoutNode[],
  path: string
): void {
  for (let index = fibers.length - 1; index >= 0; index -= 1) {
    stack.push({
      fiber: fibers[index],
      parentChildren,
      path: `${path}.${index}`,
    });
  }
}

function fiberToNode(
  fiber: ReactFiberLike,
  path: string,
  context: CollectContext
): PendingLayoutNode | null {
  if (context.visited.has(fiber)) {
    return null;
  }
  context.visited.add(fiber);

  const displayName = getDisplayName(fiber);
  const layoutTarget = findInspectableHostFiber(fiber);
  const rawProps = getProps(layoutTarget ?? fiber);
  const props = sanitizeProps(rawProps);
  const primitiveText = fiber.tag === 6 ? getDirectFiberText(fiber) : undefined;

  const node: PendingLayoutNode = {
    id: path,
    layoutTarget,
    type: displayName,
    displayName,
  };

  if (primitiveText) {
    node.text = truncateString(primitiveText);
  }
  if (props && Object.keys(props).length > 0) {
    node.props = props;
  }
  if (fiber._debugSource) {
    node.source = {
      fileName: fiber._debugSource.fileName,
      lineNumber: fiber._debugSource.lineNumber,
      columnNumber: fiber._debugSource.columnNumber,
    };
  }

  return node;
}

function getSiblingFibers(fiber: ReactFiberLike | null): ReactFiberLike[] {
  const fibers: ReactFiberLike[] = [];
  let cursor: ReactFiberLike | null | undefined = fiber;
  while (cursor) {
    fibers.push(cursor);
    cursor = cursor.sibling;
  }
  return fibers;
}

function shouldIgnoreElement(displayName: string): boolean {
  return IGNORED_ELEMENT_NAMES.has(displayName);
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

  const visited = new Set<ReactFiberLike>();
  const stack: ReactFiberLike[] = [fiber];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    if (isHostFiber(current)) {
      return current;
    }

    const children: ReactFiberLike[] = [];
    let child = current.child ?? null;
    while (child && !visited.has(child)) {
      children.push(child);
      child = child.sibling ?? null;
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return null;
}

async function measureLayout(
  fiber: ReactFiberLike | null
): Promise<ElementInspectorNode['layout'] | undefined> {
  const measureTarget = getMeasurableHostInstance(fiber?.stateNode);
  const legacyReactTag = measureTarget ? null : getReactTag(fiber?.stateNode);
  const legacyMeasure = legacyReactTag == null ? null : getLegacyMeasure();

  if (!measureTarget && (!legacyMeasure || legacyReactTag == null)) {
    return undefined;
  }

  return new Promise((resolve) => {
    try {
      const handleMeasure: MeasureCallback = (
        x,
        y,
        width,
        height,
        pageX,
        pageY
      ) => {
        resolve({
          x: Number.isFinite(pageX) ? pageX : x,
          y: Number.isFinite(pageY) ? pageY : y,
          width,
          height,
        });
      };

      if (measureTarget) {
        measureTarget.measure(handleMeasure);
      } else if (legacyMeasure && legacyReactTag != null) {
        legacyMeasure(legacyReactTag, handleMeasure);
      }
    } catch {
      resolve(undefined);
    }
  });
}

function getMeasurableHostInstance(
  hostInstance: unknown
): MeasurableHostInstance | null {
  if (!hostInstance || typeof hostInstance !== 'object') {
    return null;
  }

  const canonical = getObjectValue(hostInstance, 'canonical');
  const node = getObjectValue(hostInstance, 'node');
  const publicInstance = getObjectValue(canonical, 'publicInstance');
  const canonicalNode = getObjectValue(canonical, 'node');

  for (const candidate of [
    hostInstance,
    publicInstance,
    canonical,
    node,
    canonicalNode,
  ]) {
    if (isMeasurableHostInstance(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isMeasurableHostInstance(
  value: unknown
): value is MeasurableHostInstance {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Partial<MeasurableHostInstance>).measure === 'function'
  );
}

function getLegacyMeasure(): LegacyMeasure | null {
  const legacyUIManager = UIManager as unknown as {
    measure?: LegacyMeasure;
  };

  return typeof legacyUIManager.measure === 'function'
    ? legacyUIManager.measure.bind(legacyUIManager)
    : null;
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
  const seen = new Set<object>();
  const stack: unknown[] = [type];

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      return current;
    }

    if (typeof current === 'function') {
      return getNamedValue(current, 'displayName') ?? current.name ?? 'Anonymous';
    }

    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }

    seen.add(current);

    const displayName = getNamedValue(current, 'displayName');
    if (displayName) {
      return displayName;
    }

    const name = getNamedValue(current, 'name');
    if (name) {
      return name;
    }

    const render = getObjectValue(current, 'render');
    if (render) {
      stack.push(render);
    }

    const nestedType = getObjectValue(current, 'type');
    if (nestedType && nestedType !== current) {
      stack.push(nestedType);
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

  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts: string[] = [];
  const stack = [...value].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current));
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
    }
  }

  return parts.length > 0 ? parts.join('') : undefined;
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
