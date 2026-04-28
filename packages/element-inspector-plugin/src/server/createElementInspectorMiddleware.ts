import type {
  MiddlewareNext,
  PluginEndpointContext,
} from 'react-native-scalable-debugger/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ElementInspectorController } from './ElementInspectorController';
import { compactElementTree } from './compactElementTree';
import { renderElementTreeText } from './renderElementTreeText';

const SUPPORTED_QUERY_PARAMS = new Set([
  'appId',
  'timeoutMs',
  'compact',
  'plain',
]);
const SUPPORTED_QUERY_PARAMS_MESSAGE = 'appId, timeoutMs, compact, and plain';

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
    const result = await controller.requestSnapshot(context, {
      appId: requestUrl.searchParams.get('appId') ?? undefined,
      timeoutMs: parseTimeoutMs(requestUrl.searchParams.get('timeoutMs')),
    });

    if (result.ok) {
      const snapshotRoot =
        compact && result.snapshot.root
          ? compactElementTree(result.snapshot.root) ?? undefined
          : result.snapshot.root;

      if (plain) {
        writeText(
          response,
          result.statusCode,
          renderElementTreeText(snapshotRoot)
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

function parseTimeoutMs(value: string | null): number | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseModeFlag(value: string | null): boolean {
  return value === '1';
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
  response.end(JSON.stringify(body));
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
