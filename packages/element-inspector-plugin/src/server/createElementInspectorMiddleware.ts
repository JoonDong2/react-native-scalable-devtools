import type {
  MiddlewareNext,
  PluginEndpointContext,
} from '@react-native-scalable-devtools/cli/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ElementInspectorController } from './ElementInspectorController';
import type { ElementInspectorLayout, ElementInspectorNode } from '../shared/protocol';
import { compactElementTree } from './compactElementTree';
import { renderElementTreeText } from './renderElementTreeText';
import { stringifyJson } from '../shared/stringifyJson';

const SUPPORTED_QUERY_PARAMS = new Set([
  'appId',
  'start',
  'compact',
  'plain',
  'layoutPrecision',
  'nodeId',
]);
const SUPPORTED_QUERY_PARAMS_MESSAGE =
  'appId, start, compact, plain, layoutPrecision, and nodeId';
const DEFAULT_LAYOUT_PRECISION = 1;

interface LayoutTreeNode {
  id?: string;
  layout?: ElementInspectorLayout;
  children?: LayoutTreeNode[];
}

export function createElementInspectorMiddleware(
  controller: ElementInspectorController
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: PluginEndpointContext,
    _next: MiddlewareNext
  ): Promise<void> => {
    controller.attach(context);

    if (request.method !== 'GET') {
      writeJson(response, 405, {
        ok: false,
        error: 'method_not_allowed',
        message: 'Element inspector only supports GET requests.',
      });
      return;
    }

    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const unsupportedQueryParams = getUnsupportedQueryParams(
      requestUrl.searchParams
    );
    if (unsupportedQueryParams.length > 0) {
      writeJson(response, 400, {
        ok: false,
        error: 'unsupported_query_param',
        message: `Unsupported element inspector query parameter(s): ${unsupportedQueryParams.join(
          ', '
        )}. Supported parameters are ${SUPPORTED_QUERY_PARAMS_MESSAGE}. Use GET /apps to list connected apps.`,
      });
      return;
    }

    const compact = parseModeFlag(requestUrl.searchParams.get('compact'));
    const plain = parseModeFlag(requestUrl.searchParams.get('plain'));
    const start = parseStartType(requestUrl.searchParams.get('start'));
    const layoutPrecision = parseLayoutPrecision(
      requestUrl.searchParams.get('layoutPrecision')
    );
    const nodeId = parseOptionalModeFlag(requestUrl.searchParams.get('nodeId'));
    const includeNodeId = nodeId ?? (!compact && !plain);
    const result = await controller.requestSnapshot(context, {
      appId: requestUrl.searchParams.get('appId') ?? undefined,
    });

    if (result.ok) {
      const startedRoot =
        start && result.snapshot.root
          ? findStartNode(result.snapshot.root, start)
          : result.snapshot.root;
      const snapshotRoot =
        compact && startedRoot
          ? compactElementTree(startedRoot, { includeNodeId }) ?? undefined
          : startedRoot;
      normalizeLayoutPrecision(snapshotRoot, layoutPrecision);
      if (!includeNodeId) {
        removeNodeIds(snapshotRoot);
      }

      if (plain) {
        writeText(
          response,
          result.statusCode,
          renderElementTreeText(snapshotRoot, { includeNodeId })
        );
        return;
      }

      writeJson(response, result.statusCode, {
        ok: result.ok,
        device: result.device,
        snapshot: {
          ...result.snapshot,
          root: snapshotRoot,
        },
      });
      return;
    }

    writeJson(response, result.statusCode, withoutStatusCode(result));
  };
}

function getUnsupportedQueryParams(searchParams: URLSearchParams): string[] {
  return Array.from(new Set(searchParams.keys())).filter(
    (param) => !SUPPORTED_QUERY_PARAMS.has(param)
  );
}

function parseModeFlag(value: string | null): boolean {
  return value === '1';
}

function parseOptionalModeFlag(value: string | null): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  return value === '1';
}

function parseStartType(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseLayoutPrecision(value: string | null): number {
  const parsed = value == null ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_LAYOUT_PRECISION;
}

function findStartNode(
  root: ElementInspectorNode,
  type: string
): ElementInspectorNode | undefined {
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((node.displayName ?? node.type) === type) {
      return node;
    }

    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return undefined;
}

function normalizeLayoutPrecision(
  node: LayoutTreeNode | undefined,
  precision: number
): void {
  if (!node) {
    return;
  }

  const factor = 10 ** precision;
  const layout = node.layout;
  if (layout) {
    node.layout = {
      x: roundLayoutValue(layout.x, factor),
      y: roundLayoutValue(layout.y, factor),
      width: roundLayoutValue(layout.width, factor),
      height: roundLayoutValue(layout.height, factor),
    };
  }

  for (const child of node.children ?? []) {
    normalizeLayoutPrecision(child, precision);
  }
}

function removeNodeIds(node: LayoutTreeNode | undefined): void {
  if (!node) {
    return;
  }

  delete node.id;
  for (const child of node.children ?? []) {
    removeNodeIds(child);
  }
}

function roundLayoutValue(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

function withoutStatusCode<T extends { statusCode: number }>(
  value: T
): Omit<T, 'statusCode'> {
  const { statusCode: _statusCode, ...rest } = value;
  return rest;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(stringifyJson(body));
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  body: string
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(body);
}
