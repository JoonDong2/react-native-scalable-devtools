import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  REACT_QUERY_CDP_DISABLE_METHOD,
  REACT_QUERY_CDP_ENABLE_METHOD,
  REACT_QUERY_CDP_GET_QUERIES_METHOD,
  REACT_QUERY_PERFORM_METHOD,
  REACT_QUERY_RESULT_METHOD,
  type ReactQueryPerformParams,
  type ReactQueryResult,
} from '../shared/protocol';
import { performReactQueryAction } from './actions';
import {
  createReactQuerySnapshot,
  setReactQueryWatching,
} from './queryWatcher';

interface AppProxyMessage {
  id?: number;
  method?: string;
  params?: unknown;
}

let installed = false;

export function installReactQueryRequestHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  DebuggerConnection.addEventListener((payload: AppProxyMessage) => {
    switch (payload.method) {
      case REACT_QUERY_PERFORM_METHOD:
        void handlePerformRequest(payload.params);
        return;
      case REACT_QUERY_CDP_ENABLE_METHOD:
        handleCdpEnableRequest(payload);
        return;
      case REACT_QUERY_CDP_DISABLE_METHOD:
        handleCdpDisableRequest(payload);
        return;
      case REACT_QUERY_CDP_GET_QUERIES_METHOD:
        handleCdpGetQueriesRequest(payload);
        return;
    }
  });
}

async function handlePerformRequest(params: unknown): Promise<void> {
  const request = parsePerformParams(params);
  if (!request) {
    return;
  }

  const result = await performReactQueryAction(
    {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
    },
    request.action
  );
  safeSendResult(result);
}

function handleCdpEnableRequest(payload: AppProxyMessage): void {
  setReactQueryWatching(true);
  sendCdpResult(payload.id, {});
}

function handleCdpDisableRequest(payload: AppProxyMessage): void {
  setReactQueryWatching(false);
  sendCdpResult(payload.id, {});
}

function handleCdpGetQueriesRequest(payload: AppProxyMessage): void {
  const snapshot = createReactQuerySnapshot();
  sendCdpResult(payload.id, {
    snapshot,
  });
}

function sendCdpResult(
  id: number | undefined,
  result: Record<string, unknown>
): void {
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

function safeSendResult(result: ReactQueryResult): void {
  try {
    DebuggerConnection.send({
      method: REACT_QUERY_RESULT_METHOD,
      params: result,
    });
  } catch (error) {
    try {
      DebuggerConnection.send({
        method: REACT_QUERY_RESULT_METHOD,
        params: {
          ...result,
          completedAt: Date.now(),
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      // Keep query inspection from surfacing unhandled runtime errors.
    }
  }
}

function parsePerformParams(value: unknown): ReactQueryPerformParams | null {
  const params = typeof value === 'string' ? parseJson(value) : value;
  if (!params || typeof params !== 'object') {
    return null;
  }

  const candidate = params as Partial<ReactQueryPerformParams>;
  if (
    typeof candidate.requestId !== 'string' ||
    typeof candidate.requestedAt !== 'number' ||
    typeof candidate.action !== 'string'
  ) {
    return null;
  }

  return candidate as ReactQueryPerformParams;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
