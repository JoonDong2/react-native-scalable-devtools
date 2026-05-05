import type {
  MiddlewareEndpointContribution,
  MiddlewareNext,
  PluginEndpointContext,
} from '@react-native-scalable-devtools/cli/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import { REACT_QUERY_QUERIES_ENDPOINT } from '../shared/protocol';
import type {
  ControllerQueryResult,
  ReactQueryController,
} from './ReactQueryController';

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
) => Promise<void>;

export function createReactQueryMiddlewareEndpoints(
  controller: ReactQueryController
): MiddlewareEndpointContribution[] {
  return [
    createEndpoint(REACT_QUERY_QUERIES_ENDPOINT, (request, response, context) =>
      handleQueries(controller, request, response, context)
    ),
  ];
}

function createEndpoint(
  path: string,
  handler: Handler
): MiddlewareEndpointContribution {
  return {
    path,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      context: PluginEndpointContext,
      _next: MiddlewareNext
    ) => handler(request, response, context),
  };
}

async function handleQueries(
  controller: ReactQueryController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'GET')) {
    return;
  }

  const url = getRequestUrl(request);
  const result = await controller.requestRuntimeAction(context, {
    action: 'getQueries',
    appId: getStringParam(url, 'appId'),
  });
  writeControllerResult(response, result);
}

function allowMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: 'GET'
): boolean {
  if (request.method === method) {
    return true;
  }

  writeJson(response, 405, {
    ok: false,
    error: 'method_not_allowed',
    message: `This endpoint only supports ${method} requests.`,
  });
  return false;
}

function writeControllerResult(
  response: ServerResponse,
  result: ControllerQueryResult
): void {
  writeJson(response, result.statusCode, withoutStatusCode(result));
}

function withoutStatusCode<T extends { statusCode: number }>(
  value: T
): Omit<T, 'statusCode'> {
  const { statusCode: _statusCode, ...rest } = value;
  return rest;
}

function getRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url || '/', 'http://localhost');
}

function getStringParam(url: URL, name: string): string | undefined {
  return url.searchParams.get(name) ?? undefined;
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
