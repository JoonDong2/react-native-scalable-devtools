import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  ELEMENT_INSPECTOR_GET_TREE_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_CHUNK_METHOD,
  type ElementInspectorGetTreeParams,
  type ElementInspectorSnapshot,
} from '../shared/protocol';
import { stringifyJson } from '../shared/stringifyJson';
import { collectElementTree } from './collectElementTree';

interface AppProxyMessage {
  method?: string;
  params?: unknown;
}

// Android RN WebSocket이 수 MB 단일 프레임을 침묵 드롭하는 경우가 있어 청킹 전송을 사용한다.
const SNAPSHOT_CHUNK_SIZE = 65536;

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

function sendSnapshotChunks(snapshot: ElementInspectorSnapshot): void {
  const stringified = stringifyJson(snapshot);
  const total = Math.max(1, Math.ceil(stringified.length / SNAPSHOT_CHUNK_SIZE));
  for (let i = 0; i < total; i += 1) {
    const start = i * SNAPSHOT_CHUNK_SIZE;
    const payload = stringified.slice(start, start + SNAPSHOT_CHUNK_SIZE);
    DebuggerConnection.send(
      stringifyJson({
        method: ELEMENT_INSPECTOR_SNAPSHOT_CHUNK_METHOD,
        params: stringifyJson({
          requestId: snapshot.requestId,
          chunkIndex: i,
          totalChunks: total,
          payload,
        }),
      })
    );
  }
}

function safeSendSnapshot(
  snapshot: ElementInspectorSnapshot,
  request: ElementInspectorGetTreeParams
): void {
  try {
    sendSnapshotChunks(snapshot);
  } catch (error) {
    try {
      sendSnapshotChunks(createErrorSnapshot(request, error));
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
