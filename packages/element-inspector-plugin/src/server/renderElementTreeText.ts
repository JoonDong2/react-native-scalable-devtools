import type { ElementInspectorLayout } from '../shared/protocol';

export interface RenderableElementTreeNode {
  type: string;
  text?: string;
  layout?: ElementInspectorLayout;
  children?: RenderableElementTreeNode[];
}

export function renderElementTreeText(
  root: RenderableElementTreeNode | null | undefined
): string {
  if (!root) {
    return '';
  }

  const lines: string[] = [];
  appendNode(lines, root, 0);
  return lines.join('\n');
}

function appendNode(
  lines: string[],
  node: RenderableElementTreeNode,
  depth: number
): void {
  const parts = [`${'  '.repeat(depth)}${node.type}`];

  if (node.text !== undefined) {
    parts.push(JSON.stringify(node.text));
  }
  if (node.layout) {
    parts.push(renderLayout(node.layout));
  }

  lines.push(parts.join(' '));

  for (const child of node.children ?? []) {
    appendNode(lines, child, depth + 1);
  }
}

function renderLayout(layout: ElementInspectorLayout): string {
  return `[${formatNumber(layout.x)},${formatNumber(layout.y)},${formatNumber(
    layout.width
  )},${formatNumber(layout.height)}]`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'null';
}
