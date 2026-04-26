import type {
  MiddlewareNext,
  PluginEndpointContext,
} from 'react-native-scalable-debugger/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ElementInspectorController } from './ElementInspectorController';

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

    const result = await controller.requestSnapshot(context, {
      appId: requestUrl.searchParams.get('appId') ?? undefined,
      timeoutMs: parseTimeoutMs(requestUrl.searchParams.get('timeoutMs')),
    });
    writeJson(response, result.statusCode, withoutStatusCode(result));
  };
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
