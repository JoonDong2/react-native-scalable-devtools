import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  ELEMENT_INSPECTOR_GET_TREE_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
  type ElementInspectorGetTreeParams,
  type ElementInspectorSnapshot,
} from '../shared/protocol';
import { stringifyJson } from '../shared/stringifyJson';
import { collectElementTree } from './collectElementTree';

interface AppProxyMessage {
  method?: string;
  params?: unknown;
}

let installed = false;

export function installElementInspectorRequestHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  DebuggerConnection.addEventListener((payload: AppProxyMessage) => {
    if (payload.method !== ELEMENT_INSPECTOR_GET_TREE_METHOD) {
      return;
    }

    void handleGetTreeRequest(payload.params);
  });
}

async function handleGetTreeRequest(params: unknown): Promise<void> {
  const request = parseGetTreeParams(params);
  if (!request) {
    return;
  }

  const snapshot = await safeCollectElementTree(request);
  safeSendSnapshot(snapshot, request);
}

async function safeCollectElementTree(
  request: ElementInspectorGetTreeParams
): Promise<ElementInspectorSnapshot> {
  try {
    return await collectElementTree(request);
  } catch (error) {
    return {
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      capturedAt: Date.now(),
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function safeSendSnapshot(
  snapshot: ElementInspectorSnapshot,
  request: ElementInspectorGetTreeParams
): void {
  try {
    DebuggerConnection.send(
      stringifyJson({
        method: ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
        params: stringifyJson(snapshot),
      })
    );
  } catch (error) {
    try {
      DebuggerConnection.send(
        stringifyJson({
          method: ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
          params: stringifyJson(createErrorSnapshot(request, error)),
        })
      );
    } catch {
      // Avoid surfacing an unhandled promise rejection from the inspector path.
    }
  }
}

function createErrorSnapshot(
  request: ElementInspectorGetTreeParams,
  error: unknown
): ElementInspectorSnapshot {
  return {
    requestId: request.requestId,
    requestedAt: request.requestedAt,
    capturedAt: Date.now(),
    status: 'error',
    reason: error instanceof Error ? error.message : String(error),
  };
}

function parseGetTreeParams(
  params: unknown
): ElementInspectorGetTreeParams | null {
  if (!params || typeof params !== 'object') {
    return null;
  }

  const maybeParams = params as Partial<ElementInspectorGetTreeParams>;
  if (
    typeof maybeParams.requestId !== 'string' ||
    typeof maybeParams.requestedAt !== 'number'
  ) {
    return null;
  }

  return {
    requestId: maybeParams.requestId,
    requestedAt: maybeParams.requestedAt,
  };
}
