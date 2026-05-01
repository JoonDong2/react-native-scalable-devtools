import type {
  MiddlewareEndpointContribution,
  MiddlewareNext,
  PluginEndpointContext,
} from '@react-native-scalable-devtools/cli/plugin';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  AGENT_ACTIONS_BACK_ENDPOINT,
  AGENT_ACTIONS_NAVIGATE_ENDPOINT,
  AGENT_ACTIONS_NAVIGATION_STATE_ENDPOINT,
  AGENT_ACTIONS_PRESS_ENDPOINT,
  AGENT_ACTIONS_RESOLVE_VIEW_ENDPOINT,
  AGENT_ACTIONS_SCROLL_ENDPOINT,
  type AgentActionTarget,
  type AgentNavigationCommand,
  type AgentScrollCommand,
} from '../shared/protocol';
import type {
  AgentActionsController,
  ControllerActionResult,
  ControllerSnapshotResult,
} from './AgentActionsController';
import { resolveElementTargets } from './resolveElementTarget';

const MAX_BODY_BYTES = 1024 * 1024;

interface JsonBody {
  appId?: string;
  timeoutMs?: number;
  target?: AgentActionTarget;
  navigation?: AgentNavigationCommand;
  scroll?: AgentScrollCommand;
  name?: string;
  params?: unknown;
  key?: string;
  path?: string;
  merge?: boolean;
  direction?: AgentScrollCommand['direction'];
  amount?: number;
  x?: number;
  y?: number;
  offset?: number;
  animated?: boolean;
  to?: AgentScrollCommand['to'];
  query?: string;
}

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
) => Promise<void>;

export function createAgentActionsMiddlewareEndpoints(
  controller: AgentActionsController
): MiddlewareEndpointContribution[] {
  return [
    createEndpoint(
      AGENT_ACTIONS_RESOLVE_VIEW_ENDPOINT,
      (request, response, context) =>
        handleResolveView(controller, request, response, context)
    ),
    createEndpoint(
      AGENT_ACTIONS_NAVIGATION_STATE_ENDPOINT,
      (request, response, context) =>
        handleNavigationState(controller, request, response, context)
    ),
    createEndpoint(
      AGENT_ACTIONS_NAVIGATE_ENDPOINT,
      (request, response, context) =>
        handleNavigate(controller, request, response, context)
    ),
    createEndpoint(AGENT_ACTIONS_BACK_ENDPOINT, (request, response, context) =>
      handleBack(controller, request, response, context)
    ),
    createEndpoint(AGENT_ACTIONS_PRESS_ENDPOINT, (request, response, context) =>
      handlePress(controller, request, response, context)
    ),
    createEndpoint(AGENT_ACTIONS_SCROLL_ENDPOINT, (request, response, context) =>
      handleScroll(controller, request, response, context)
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

async function handleResolveView(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'POST')) {
    return;
  }

  const body = await readJsonBody(request);
  const target = normalizeTarget(body);
  const result = await controller.requestSnapshot(context, {
    appId: body.appId,
    timeoutMs: body.timeoutMs,
  });

  if (!result.ok) {
    writeControllerResult(response, result);
    return;
  }

  const matches = resolveElementTargets(result.snapshot.root, target, 10).map(
    ({ node, score }) => ({ score, node })
  );
  writeJson(response, matches.length > 0 ? 200 : 404, {
    ok: matches.length > 0,
    device: result.device,
    matches,
  });
}

async function handleNavigationState(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'GET')) {
    return;
  }

  const url = getRequestUrl(request);
  const result = await controller.requestRuntimeAction(context, {
    action: 'getNavigationState',
    appId: getStringParam(url, 'appId'),
    timeoutMs: getNumberParam(url, 'timeoutMs'),
  });
  writeControllerResult(response, result);
}

async function handleNavigate(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'POST')) {
    return;
  }

  const body = await readJsonBody(request);
  const navigation = normalizeNavigation(body);
  const result = await controller.requestRuntimeAction(context, {
    action: 'navigate',
    appId: body.appId,
    timeoutMs: body.timeoutMs,
    navigation,
  });
  writeControllerResult(response, result);
}

async function handleBack(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'POST')) {
    return;
  }

  const body = await readJsonBody(request);
  const result = await controller.requestRuntimeAction(context, {
    action: 'goBack',
    appId: body.appId,
    timeoutMs: body.timeoutMs,
  });
  writeControllerResult(response, result);
}

async function handlePress(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'POST')) {
    return;
  }

  const body = await readJsonBody(request);
  const result = await controller.requestRuntimeAction(context, {
    action: 'press',
    appId: body.appId,
    timeoutMs: body.timeoutMs,
    target: normalizeTarget(body),
  });
  writeControllerResult(response, result);
}

async function handleScroll(
  controller: AgentActionsController,
  request: IncomingMessage,
  response: ServerResponse,
  context: PluginEndpointContext
): Promise<void> {
  if (!allowMethod(request, response, 'POST')) {
    return;
  }

  const body = await readJsonBody(request);
  const result = await controller.requestRuntimeAction(context, {
    action: 'scroll',
    appId: body.appId,
    timeoutMs: body.timeoutMs,
    target: normalizeTarget(body),
    scroll: normalizeScroll(body),
  });
  writeControllerResult(response, result);
}

function normalizeTarget(body: JsonBody): AgentActionTarget | undefined {
  if (body.target && typeof body.target === 'object') {
    return body.target;
  }
  if (typeof body.query === 'string') {
    return { query: body.query };
  }
  return undefined;
}

function normalizeNavigation(body: JsonBody): AgentNavigationCommand {
  return {
    ...(body.navigation ?? {}),
    name: body.name ?? body.navigation?.name,
    params: (body.params as AgentNavigationCommand['params']) ?? body.navigation?.params,
    key: body.key ?? body.navigation?.key,
    path: body.path ?? body.navigation?.path,
    merge: body.merge ?? body.navigation?.merge,
  };
}

function normalizeScroll(body: JsonBody): AgentScrollCommand {
  return {
    ...(body.scroll ?? {}),
    direction: body.direction ?? body.scroll?.direction,
    amount: body.amount ?? body.scroll?.amount,
    x: body.x ?? body.scroll?.x,
    y: body.y ?? body.scroll?.y,
    offset: body.offset ?? body.scroll?.offset,
    animated: body.animated ?? body.scroll?.animated,
    to: body.to ?? body.scroll?.to,
  };
}

function allowMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: 'GET' | 'POST'
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

async function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as JsonBody)
    : {};
}

function writeControllerResult(
  response: ServerResponse,
  result: ControllerActionResult | ControllerSnapshotResult
): void {
  if (result.ok) {
    writeJson(response, result.statusCode, withoutStatusCode(result));
    return;
  }
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

function getNumberParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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
