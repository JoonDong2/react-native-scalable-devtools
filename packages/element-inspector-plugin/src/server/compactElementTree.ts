import type {
  ElementInspectorLayout,
  ElementInspectorNode,
  ElementInspectorSource,
  JSONValue,
} from '../shared/protocol';

export interface CompactElementInspectorNode {
  type: string;
  layout?: ElementInspectorLayout;
  text?: string;
  props?: {
    style: JSONValue;
  };
  source?: ElementInspectorSource;
  children?: CompactElementInspectorNode[];
}

const DEBUGGING_OVERLAY_NAMES = new Set(['DebuggingOverlay']);
const TEXT_HOST_TYPES = new Set(['RCTText', 'TextImplLegacy']);

export function compactElementTree(
  node: ElementInspectorNode
): CompactElementInspectorNode | null {
  return compactNode(node);
}

function compactNode(
  node: ElementInspectorNode
): CompactElementInspectorNode | null {
  if (shouldRemoveNode(node)) {
    return null;
  }

  const children = (node.children ?? [])
    .map(compactNode)
    .filter((child): child is CompactElementInspectorNode => child != null);
  const output: CompactElementInspectorNode = {
    type: node.type,
  };

  if (node.layout) {
    output.layout = node.layout;
  }
  if (node.text !== undefined) {
    output.text = node.text;
  }
  if (node.props?.style !== undefined) {
    output.props = {
      style: node.props.style,
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
  return isDebuggingOverlay(node) || hasZeroSize(node.layout);
}

function isDebuggingOverlay(node: ElementInspectorNode): boolean {
  return (
    DEBUGGING_OVERLAY_NAMES.has(node.type) ||
    (node.displayName != null && DEBUGGING_OVERLAY_NAMES.has(node.displayName))
  );
}

function hasZeroSize(layout: ElementInspectorLayout | undefined): boolean {
  return layout?.width === 0 || layout?.height === 0;
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
  if (
    parent.type === 'View' &&
    child.type === 'RCTView' &&
    hasSameLayout(parent.layout, child.layout)
  ) {
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
