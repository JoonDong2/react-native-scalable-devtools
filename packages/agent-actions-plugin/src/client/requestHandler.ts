import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  AGENT_ACTIONS_PERFORM_METHOD,
  AGENT_ACTIONS_RESULT_METHOD,
  type AgentActionPerformParams,
  type AgentActionResult,
} from '../shared/protocol';
import { performAgentAction } from './actions';

interface AppProxyMessage {
  method?: string;
  params?: unknown;
}

let installed = false;

export function installAgentActionsRequestHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  DebuggerConnection.addEventListener((payload: AppProxyMessage) => {
    if (payload.method !== AGENT_ACTIONS_PERFORM_METHOD) {
      return;
    }

    void handlePerformRequest(payload.params);
  });
}

async function handlePerformRequest(params: unknown): Promise<void> {
  const request = parsePerformParams(params);
  if (!request) {
    return;
  }

  const result = await performAgentAction(
    {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
    },
    request.action,
    {
      target: request.target,
      navigation: request.navigation,
      scroll: request.scroll,
    }
  );
  safeSendResult(result);
}

function safeSendResult(result: AgentActionResult): void {
  try {
    DebuggerConnection.send({
      method: AGENT_ACTIONS_RESULT_METHOD,
      params: result,
    });
  } catch (error) {
    try {
      DebuggerConnection.send({
        method: AGENT_ACTIONS_RESULT_METHOD,
        params: {
          ...result,
          completedAt: Date.now(),
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      // Keep agent actions from surfacing unhandled runtime errors.
    }
  }
}

function parsePerformParams(value: unknown): AgentActionPerformParams | null {
  const params = typeof value === 'string' ? parseJson(value) : value;
  if (!params || typeof params !== 'object') {
    return null;
  }

  const candidate = params as Partial<AgentActionPerformParams>;
  if (
    typeof candidate.requestId !== 'string' ||
    typeof candidate.requestedAt !== 'number' ||
    typeof candidate.action !== 'string'
  ) {
    return null;
  }

  return candidate as AgentActionPerformParams;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
