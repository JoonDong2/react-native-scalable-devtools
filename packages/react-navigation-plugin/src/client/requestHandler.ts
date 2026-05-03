import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  REACT_NAVIGATION_CDP_DISABLE_METHOD,
  REACT_NAVIGATION_CDP_ENABLE_METHOD,
  REACT_NAVIGATION_CDP_GET_STATE_METHOD,
  REACT_NAVIGATION_PERFORM_METHOD,
  REACT_NAVIGATION_RESULT_METHOD,
  type ReactNavigationPerformParams,
  type ReactNavigationResult,
} from '../shared/protocol';
import { performReactNavigationAction } from './actions';
import {
  createNavigationStateSnapshot,
  setReactNavigationStateWatching,
} from './stateWatcher';

interface AppProxyMessage {
  id?: number;
  method?: string;
  params?: unknown;
}

let installed = false;

export function installReactNavigationRequestHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  DebuggerConnection.addEventListener((payload: AppProxyMessage) => {
    switch (payload.method) {
      case REACT_NAVIGATION_PERFORM_METHOD:
        void handlePerformRequest(payload.params);
        return;
      case REACT_NAVIGATION_CDP_ENABLE_METHOD:
        handleCdpEnableRequest(payload);
        return;
      case REACT_NAVIGATION_CDP_DISABLE_METHOD:
        handleCdpDisableRequest(payload);
        return;
      case REACT_NAVIGATION_CDP_GET_STATE_METHOD:
        handleCdpGetStateRequest(payload);
        return;
    }
  });
}

async function handlePerformRequest(params: unknown): Promise<void> {
  const request = parsePerformParams(params);
  if (!request) {
    return;
  }

  const result = await performReactNavigationAction(
    {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
    },
    request.action,
    {
      navigation: request.navigation,
    }
  );
  safeSendResult(result);
}

function handleCdpEnableRequest(payload: AppProxyMessage): void {
  setReactNavigationStateWatching(true);
  sendCdpResult(payload.id, {});
}

function handleCdpDisableRequest(payload: AppProxyMessage): void {
  setReactNavigationStateWatching(false);
  sendCdpResult(payload.id, {});
}

function handleCdpGetStateRequest(payload: AppProxyMessage): void {
  const state = createNavigationStateSnapshot();
  sendCdpResult(payload.id, {
    state,
  });
}

function sendCdpResult(id: number | undefined, result: Record<string, unknown>): void {
  if (typeof id !== 'number') {
    return;
  }

  try {
    DebuggerConnection.send({
      id,
      result,
    });
  } catch {
    // CDP requests are best-effort over the debugger app socket.
  }
}

function safeSendResult(result: ReactNavigationResult): void {
  try {
    DebuggerConnection.send({
      method: REACT_NAVIGATION_RESULT_METHOD,
      params: result,
    });
  } catch (error) {
    try {
      DebuggerConnection.send({
        method: REACT_NAVIGATION_RESULT_METHOD,
        params: {
          ...result,
          completedAt: Date.now(),
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      // Keep navigation actions from surfacing unhandled runtime errors.
    }
  }
}

function parsePerformParams(value: unknown): ReactNavigationPerformParams | null {
  const params = typeof value === 'string' ? parseJson(value) : value;
  if (!params || typeof params !== 'object') {
    return null;
  }

  const candidate = params as Partial<ReactNavigationPerformParams>;
  if (
    typeof candidate.requestId !== 'string' ||
    typeof candidate.requestedAt !== 'number' ||
    typeof candidate.action !== 'string'
  ) {
    return null;
  }

  return candidate as ReactNavigationPerformParams;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
