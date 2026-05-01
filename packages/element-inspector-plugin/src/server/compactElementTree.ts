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
type NamedElementNode = Pick<ElementInspectorNode, 'type' | 'displayName'>;
export type CompactElementTreeLevel = 1 | 2;

export interface CompactElementTreeOptions {
  includeNodeId?: boolean;
  level?: CompactElementTreeLevel;
}

const IGNORED_ELEMENT_NAMES = new Set([
  'DebuggingOverlay',
  'LogBoxStateSubscription',
]);
const TEXT_HOST_TYPES = new Set(['RCTText', 'TextImplLegacy']);
const TEXT_ELEMENT_NAMES = new Set([
  'AndroidTextInput',
  'MultilineTextInputView',
  'RCTRawText',
  'RCTText',
  'RCTTextInput',
  'RawText',
  'Text',
  'TextImpl',
  'TextImplLegacy',
  'TextInput',
]);
const GESTURE_HANDLER_TOUCH_ELEMENT_NAMES = new Set([
  'BaseButton',
  'BorderlessButton',
  'Buttons',
  'DrawerLayout',
  'FlingGestureHandler',
  'ForceTouchGestureHandler',
  'GestureDetector',
  'LongPressGestureHandler',
  'NativeViewGestureHandler',
  'PanGestureHandler',
  'RawButton',
  'RectButton',
  'RotationGestureHandler',
  'Swipeable',
  'TapGestureHandler',
]);
const TOUCHABLE_NAME_PARTS = ['button', 'pressable', 'touchable'];
const SCROLLABLE_NAME_PARTS = [
  'flashlist',
  'flatlist',
  'listview',
  'recyclerlist',
  'scroll',
  'sectionlist',
  'virtualizedlist',
];
const ACTIONABLE_ACCESSIBILITY_ROLES = new Set([
  'adjustable',
  'button',
  'checkbox',
  'combobox',
  'imagebutton',
  'keyboardkey',
  'link',
  'menuitem',
  'radio',
  'search',
  'switch',
  'tab',
]);
const AGENT_ACTION_PROP_NAMES = [
  'testID',
  'nativeID',
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityRole',
  'accessibilityState',
  'accessibilityValue',
  'disabled',
];

export function compactElementTree(
  node: ElementInspectorNode,
  options: CompactElementTreeOptions = {}
): CompactElementInspectorNode | null {
  if (options.level === 2) {
    return compactAgentActionTree(node, options);
  }

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

function compactAgentActionTree(
  node: ElementInspectorNode,
  options: CompactElementTreeOptions
): CompactElementInspectorNode | null {
  const nodes = compactAgentActionNodes(node, options);
  if (nodes.length === 0) {
    return null;
  }
  if (nodes.length === 1) {
    return nodes[0];
  }
  return createStructuralRootNode(node, nodes);
}

function compactAgentActionNodes(
  node: ElementInspectorNode,
  options: CompactElementTreeOptions
): CompactElementInspectorNode[] {
  if (isIgnoredElementNode(node)) {
    return [];
  }

  const children = (node.children ?? []).flatMap((child) =>
    compactAgentActionNodes(child, options)
  );

  if (!isAgentActionRelevantNode(node)) {
    return children;
  }

  return [
    collapseAgentActionWrappers(createAgentActionNode(node, children, options)),
  ];
}

function createAgentActionNode(
  node: ElementInspectorNode,
  children: CompactElementInspectorNode[],
  options: CompactElementTreeOptions
): CompactElementInspectorNode {
  const output: CompactElementInspectorNode = {
    type: node.type,
  };
  const props = pickAgentActionProps(node.props);

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
  if (props) {
    output.props = props;
  }
  if (children.length > 0) {
    output.children = children;
  }

  return output;
}

function createStructuralRootNode(
  node: ElementInspectorNode,
  children: CompactElementInspectorNode[]
): CompactElementInspectorNode {
  return {
    type: node.type,
    ...(node.displayName !== undefined ? { displayName: node.displayName } : {}),
    children,
  };
}

function collapseAgentActionWrappers(
  node: CompactElementInspectorNode
): CompactElementInspectorNode {
  let current = node;

  while (current.children?.length === 1) {
    const child = current.children[0];
    if (!canBypassAgentActionWrapper(current, child)) {
      break;
    }
    current = child;
  }

  return current;
}

function canBypassAgentActionWrapper(
  parent: CompactElementInspectorNode,
  child: CompactElementInspectorNode
): boolean {
  return (
    isScrollableElement(parent) &&
    isScrollableElement(child) &&
    hasSameLayout(parent.layout, child.layout) &&
    !hasAgentActionTargetInfo(parent)
  );
}

function hasAgentActionTargetInfo(node: CompactElementInspectorNode): boolean {
  return node.text !== undefined || !!node.props;
}

function isAgentActionRelevantNode(node: ElementInspectorNode): boolean {
  return (
    !hasZeroSize(node.layout) &&
    (isTouchableElement(node) ||
      isScrollableElement(node) ||
      isTextElement(node) ||
      isImageElement(node))
  );
}

function isTouchableElement(node: ElementInspectorNode): boolean {
  return (
    hasExactName(node, GESTURE_HANDLER_TOUCH_ELEMENT_NAMES) ||
    hasNamePart(node, TOUCHABLE_NAME_PARTS) ||
    hasNamePart(node, ['gesturehandler']) ||
    hasAccessibilityRole(node, ACTIONABLE_ACCESSIBILITY_ROLES)
  );
}

function isScrollableElement(node: NamedElementNode): boolean {
  return hasNamePart(node, SCROLLABLE_NAME_PARTS);
}

function isTextElement(node: ElementInspectorNode): boolean {
  return (
    node.text !== undefined ||
    hasExactName(node, TEXT_ELEMENT_NAMES) ||
    hasNamePart(node, ['textinput'])
  );
}

function isImageElement(node: ElementInspectorNode): boolean {
  return hasNamePart(node, ['image']);
}

function pickAgentActionProps(
  props: Record<string, JSONValue> | undefined
): Record<string, JSONValue> | undefined {
  if (!props) {
    return undefined;
  }

  const output: Record<string, JSONValue> = {};
  for (const key of AGENT_ACTION_PROP_NAMES) {
    const value = compactAgentActionPropValue(props[key]);
    if (value !== undefined) {
      output[key] = value;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function compactAgentActionPropValue(value: JSONValue | undefined): JSONValue | undefined {
  if (value == null) {
    return undefined;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map(compactAgentActionPropValue)
      .filter((item): item is JSONValue => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  const output: Record<string, JSONValue> = {};
  for (const [key, childValue] of Object.entries(value)) {
    const compactValue = compactAgentActionPropValue(childValue);
    if (compactValue !== undefined) {
      output[key] = compactValue;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function hasAccessibilityRole(
  node: ElementInspectorNode,
  roles: Set<string>
): boolean {
  const role = node.props?.accessibilityRole;
  return typeof role === 'string' && roles.has(role.toLowerCase());
}

function hasExactName(node: NamedElementNode, names: Set<string>): boolean {
  return getNodeNames(node).some((name) => names.has(name));
}

function hasNamePart(node: NamedElementNode, parts: string[]): boolean {
  return getNodeNames(node).some((name) => {
    const normalizedName = name.toLowerCase();
    return parts.some((part) => normalizedName.includes(part));
  });
}

function getNodeNames(node: NamedElementNode): string[] {
  return node.displayName && node.displayName !== node.type
    ? [node.type, node.displayName]
    : [node.type];
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
