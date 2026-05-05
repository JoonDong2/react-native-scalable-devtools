import type {
  ElementInspectorLayout,
  ElementInspectorNode,
  ElementInspectorSource,
  JSONValue,
} from '../shared/protocol';

export interface CompactElementInspectorNode {
  id?: string;
  type: string;
  displayName?: string;
  layout?: ElementInspectorLayout;
  text?: string;
  props?: Record<string, JSONValue>;
  source?: ElementInspectorSource;
  children?: CompactElementInspectorNode[];
}

type JSONObject = { [key: string]: JSONValue };

export interface CompactElementTreeOptions {
  includeNodeId?: boolean;
}

const IGNORED_ELEMENT_NAMES = new Set([
  'DebuggingOverlay',
  'LogBoxStateSubscription',
]);
const TEXT_HOST_TYPES = new Set(['RCTText', 'TextImplLegacy']);

export function compactElementTree(
  node: ElementInspectorNode,
  options: CompactElementTreeOptions = {}
): CompactElementInspectorNode | null {
  return compactNode(node, options);
}

function compactNode(
  node: ElementInspectorNode,
  options: CompactElementTreeOptions
): CompactElementInspectorNode | null {
  if (shouldRemoveNode(node)) {
    return null;
  }

  const children = (node.children ?? [])
    .map((child) => compactNode(child, options))
    .filter((child): child is CompactElementInspectorNode => child != null);
  const output: CompactElementInspectorNode = {
    type: node.type,
  };

  if (options.includeNodeId) {
    output.id = node.id;
  }
  if (node.displayName !== undefined) {
    output.displayName = node.displayName;
  }
  if (node.layout) {
    output.layout = node.layout;
  }
  if (node.text !== undefined) {
    output.text = node.text;
  }
  if (node.props?.style !== undefined) {
    output.props = {
      style: compactStyleValue(node.props.style),
    };
  }
  if (node.source) {
    output.source = node.source;
  }
  if (children.length > 0) {
    output.children = children;
  }

  return collapseWrappers(output);
}

function shouldRemoveNode(node: ElementInspectorNode): boolean {
  return isIgnoredElementNode(node) || hasZeroSize(node.layout);
}

function isIgnoredElementNode(node: ElementInspectorNode): boolean {
  return (
    IGNORED_ELEMENT_NAMES.has(node.type) ||
    (node.displayName != null && IGNORED_ELEMENT_NAMES.has(node.displayName))
  );
}

function hasZeroSize(layout: ElementInspectorLayout | undefined): boolean {
  return layout?.width === 0 || layout?.height === 0;
}

function compactStyleValue(style: JSONValue): JSONValue {
  return Array.isArray(style) ? flattenStyleArray(style) : style;
}

function flattenStyleArray(styleItems: JSONValue[]): JSONObject {
  const output: JSONObject = {};

  for (const item of styleItems) {
    const styleObject = Array.isArray(item)
      ? flattenStyleArray(item)
      : getStyleObject(item);
    if (styleObject) {
      Object.assign(output, styleObject);
    }
  }

  return output;
}

function getStyleObject(value: JSONValue): JSONObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function collapseWrappers(
  node: CompactElementInspectorNode
): CompactElementInspectorNode {
  let current = node;

  while (current.children?.length === 1) {
    const child = current.children[0];
    if (!canBypassWrapper(current, child)) {
      break;
    }
    current = child;
  }

  return current;
}

function canBypassWrapper(
  parent: CompactElementInspectorNode,
  child: CompactElementInspectorNode
): boolean {
  if (hasSameLayout(parent.layout, child.layout)) {
    return true;
  }

  return parent.type === 'Text' && TEXT_HOST_TYPES.has(child.type);
}

function hasSameLayout(
  left: ElementInspectorLayout | undefined,
  right: ElementInspectorLayout | undefined
): boolean {
  return (
    !!left &&
    !!right &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
