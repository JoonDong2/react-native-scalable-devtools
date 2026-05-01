import type { ElementInspectorNode } from '@react-native-scalable-devtools/element-inspector-plugin';
import type { AgentActionTarget, JSONValue } from '../shared/protocol';

export interface ResolvedElementTarget {
  node: ElementInspectorNode;
  score: number;
}

export function resolveElementTargets(
  root: ElementInspectorNode | undefined,
  target: AgentActionTarget | undefined,
  limit = 5
): ResolvedElementTarget[] {
  if (!root || !target) {
    return [];
  }

  const nodes = flattenNodes(root);
  if (target.id) {
    const node = nodes.find((candidate) => candidate.id === target.id);
    return node ? [{ node, score: 1000 }] : [];
  }

  return nodes
    .map((node) => ({ node, score: scoreNode(node, target) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function flattenNodes(root: ElementInspectorNode): ElementInspectorNode[] {
  const nodes: ElementInspectorNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    nodes.push(node);
    stack.unshift(...(node.children ?? []));
  }
  return nodes;
}

function scoreNode(
  node: ElementInspectorNode,
  target: AgentActionTarget
): number {
  const props = node.props ?? {};
  let score = 0;

  score += scoreField(props.testID, target.testID, target.exact, 100);
  score += scoreField(props.nativeID, target.nativeID, target.exact, 90);
  score += scoreField(
    props.accessibilityLabel,
    target.accessibilityLabel,
    target.exact,
    80
  );
  score += scoreField(getNodeText(node), target.text, target.exact, 70);
  score += scoreField(node.displayName, target.displayName, true, 50);
  score += scoreField(node.type, target.type, true, 45);

  if (target.query) {
    const query = normalizeText(target.query);
    score += scoreQuery(query, props.testID, 45);
    score += scoreQuery(query, props.nativeID, 40);
    score += scoreQuery(query, props.accessibilityLabel, 35);
    score += scoreQuery(query, getNodeText(node), 30);
    score += scoreQuery(query, node.displayName, 15);
    score += scoreQuery(query, node.type, 10);
  }

  return score;
}

function getNodeText(node: ElementInspectorNode): string | undefined {
  const parts: string[] = [];
  if (node.text) {
    parts.push(node.text);
  }
  for (const child of node.children ?? []) {
    const childText = getNodeText(child);
    if (childText) {
      parts.push(childText);
    }
  }
  return parts.length > 0 ? parts.join(' ').trim() : undefined;
}

function scoreField(
  value: JSONValue | string | undefined,
  expected: string | undefined,
  exact: boolean | undefined,
  weight: number
): number {
  if (!expected || typeof value !== 'string') {
    return 0;
  }
  const normalizedValue = normalizeText(value);
  const normalizedExpected = normalizeText(expected);
  if (normalizedValue === normalizedExpected) {
    return weight;
  }
  return exact ? 0 : normalizedValue.includes(normalizedExpected) ? weight / 2 : 0;
}

function scoreQuery(query: string, value: JSONValue | string | undefined, weight: number): number {
  if (!query || typeof value !== 'string') {
    return 0;
  }
  const normalizedValue = normalizeText(value);
  if (normalizedValue === query) {
    return weight;
  }
  return normalizedValue.includes(query) ? weight / 2 : 0;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
