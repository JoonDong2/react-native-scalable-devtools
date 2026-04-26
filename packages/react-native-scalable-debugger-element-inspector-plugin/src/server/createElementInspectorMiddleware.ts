import type {
  MiddlewareNext,
  PluginEndpointContext,
} from 'react-native-scalable-debugger/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ElementInspectorController } from './ElementInspectorController';

const SUPPORTED_QUERY_PARAMS = new Set(['appId', 'timeoutMs']);

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
        )}. Supported parameters are appId and timeoutMs. Use GET /apps to list connected apps.`,
      });
      return;
    }

    const result = await controller.requestSnapshot(context, {
      appId: requestUrl.searchParams.get('appId') ?? undefined,
      timeoutMs: parseTimeoutMs(requestUrl.searchParams.get('timeoutMs')),
    });
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
