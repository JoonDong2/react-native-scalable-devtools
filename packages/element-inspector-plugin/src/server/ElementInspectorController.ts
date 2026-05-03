import type { PluginEndpointContext } from '@react-native-scalable-devtools/cli/plugin';
import {
  ELEMENT_INSPECTOR_GET_TREE_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_CHUNK_METHOD,
  type ElementInspectorDevice,
  type ElementInspectorErrorResponse,
  type ElementInspectorGetTreeParams,
  type ElementInspectorSnapshot,
  type ElementInspectorSuccessResponse,
} from '../shared/protocol';
import { createRequestId } from './createRequestId';

interface AppProxyMessage {
  method?: string;
  params?: unknown;
}

// Android RN WebSocket이 큰 단일 프레임을 침묵 드롭하는 경우가 있어 청킹 전송을 받는다.
const chunkBuffers = new Map<string, { totalChunks: number, parts: string[], received: number }>();

function parseChunk(value: unknown): { requestId: string, chunkIndex: number, totalChunks: number, payload: string } | null {
  const v = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value as any;
  if (!v || typeof v !== 'object') return null;
  if (
    typeof v.requestId !== 'string' ||
    typeof v.chunkIndex !== 'number' ||
    typeof v.totalChunks !== 'number' ||
    typeof v.payload !== 'string'
  ) {
    return null;
  }
  return v;
}

const SNAPSHOT_REQUEST_TIMEOUT_MS = 30000;

export interface SnapshotRequestOptions {
  appId?: string;
}

export interface ControllerSuccessResult extends ElementInspectorSuccessResponse {
  statusCode: number;
}

export interface ControllerErrorResult extends ElementInspectorErrorResponse {
  statusCode: number;
}

export type ControllerSnapshotResult =
  | ControllerSuccessResult
  | ControllerErrorResult;

export type SnapshotListener = (
  result: ElementInspectorSuccessResponse
) => void;

interface PendingSnapshotRequest {
  device: ElementInspectorDevice;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: ControllerSnapshotResult) => void;
}

export class ElementInspectorController {
  #context: PluginEndpointContext | null = null;
  #detachAppMessageListener: (() => void) | null = null;
  #pendingRequests = new Map<string, PendingSnapshotRequest>();
  #snapshotListeners = new Set<SnapshotListener>();

  attach(context: PluginEndpointContext): void {
    if (this.#context === context) {
      return;
    }

    this.#detachAppMessageListener?.();
    this.#context = context;
    this.#detachAppMessageListener = context.socketContext.onAppMessage(
      (payload, target) => {
        this.handleAppMessage(payload, toElementInspectorDevice(target));
      }
    );
  }

  listDevices(context?: PluginEndpointContext): ElementInspectorDevice[] {
    const activeContext = this.#getContext(context);
    if (!activeContext) {
      return [];
    }

    return activeContext.socketContext
      .listAppConnections()
      .map(toElementInspectorDevice);
  }

  requestSnapshot(
    context: PluginEndpointContext,
    options: SnapshotRequestOptions = {}
  ): Promise<ControllerSnapshotResult> {
    this.attach(context);

    const selection = this.#selectApp(options.appId);
    if (!selection.ok) {
      return Promise.resolve(selection);
    }

    const requestId = createRequestId();
    const requestedAt = Date.now();
    const params: ElementInspectorGetTreeParams = {
      requestId,
      requestedAt,
    };

    return new Promise<ControllerSnapshotResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(requestId);
        chunkBuffers.delete(requestId);
        resolve({
          ok: false,
          statusCode: 504,
          error: 'snapshot_timeout',
          message: `Element inspector snapshot request timed out after ${SNAPSHOT_REQUEST_TIMEOUT_MS}ms.`,
          devices: this.listDevices(context),
        });
      }, SNAPSHOT_REQUEST_TIMEOUT_MS);

      this.#pendingRequests.set(requestId, {
        device: selection.device,
        timeout,
        resolve,
      });

      let sent = false;
      try {
        sent = context.socketContext.sendToAppById(selection.device.appId, {
          method: ELEMENT_INSPECTOR_GET_TREE_METHOD,
          params,
        });
      } catch (error) {
        this.#pendingRequests.delete(requestId);
        clearTimeout(timeout);
        resolve({
          ok: false,
          statusCode: 500,
          error: 'request_send_failed',
          message:
            error instanceof Error
              ? error.message
              : `Failed to send element inspector request: ${String(error)}`,
          devices: this.listDevices(context),
        });
        return;
      }

      if (!sent) {
        this.#pendingRequests.delete(requestId);
        clearTimeout(timeout);
        resolve({
          ok: false,
          statusCode: 503,
          error: 'device_unavailable',
          message: `No active app connection found for appId "${selection.device.appId}".`,
          devices: this.listDevices(context),
        });
      }
    });
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#snapshotListeners.add(listener);
    return () => {
      this.#snapshotListeners.delete(listener);
    };
  }

  handleAppMessage(
    payload: AppProxyMessage,
    target: ElementInspectorDevice
  ): void {
    if (payload.method === ELEMENT_INSPECTOR_SNAPSHOT_METHOD) {
      const snapshot = parseSnapshot(payload.params);
      if (snapshot) this.deliverSnapshot(snapshot, target);
      return;
    }
    if (payload.method === ELEMENT_INSPECTOR_SNAPSHOT_CHUNK_METHOD) {
      const chunk = parseChunk(payload.params);
      if (!chunk) return;
      let buffer = chunkBuffers.get(chunk.requestId);
      if (!buffer) {
        buffer = { totalChunks: chunk.totalChunks, parts: new Array(chunk.totalChunks), received: 0 };
        chunkBuffers.set(chunk.requestId, buffer);
      }
      if (buffer.parts[chunk.chunkIndex] === undefined) {
        buffer.parts[chunk.chunkIndex] = chunk.payload;
        buffer.received += 1;
      }
      if (buffer.received === buffer.totalChunks) {
        chunkBuffers.delete(chunk.requestId);
        const assembled = buffer.parts.join('');
        const snapshot = parseSnapshot(assembled);
        if (snapshot) this.deliverSnapshot(snapshot, target);
      }
      return;
    }
  }

  deliverSnapshot(snapshot: ElementInspectorSnapshot, target: ElementInspectorDevice) {
    const pending = this.#pendingRequests.get(snapshot.requestId);
    if (!pending || !isSameDevice(pending.device, target)) {
      return;
    }

    this.#pendingRequests.delete(snapshot.requestId);
    clearTimeout(pending.timeout);

    const result: ControllerSuccessResult = {
      ok: true,
      statusCode: 200,
      device: target,
      snapshot,
    };
    pending.resolve(result);

    const broadcast: ElementInspectorSuccessResponse = {
      ok: true,
      device: target,
      snapshot,
    };
    this.#snapshotListeners.forEach((listener) => listener(broadcast));
  }

  #selectApp(
    requestedAppId?: string
  ): { ok: true; device: ElementInspectorDevice } | ControllerErrorResult {
    const devices = this.listDevices();

    if (devices.length === 0) {
      return {
        ok: false,
        statusCode: 503,
        error: 'no_devices',
        message: 'No connected React Native app devices are available.',
        devices,
      };
    }

    if (requestedAppId) {
      const device = devices.find(
        (candidate) => candidate.appId === requestedAppId
      );

      if (!device) {
        return {
          ok: false,
          statusCode: 404,
          error: 'device_not_found',
          message: `No connected React Native app matches appId "${requestedAppId}".`,
          devices,
        };
      }

      return { ok: true, device };
    }

    if (devices.length > 1) {
      return {
        ok: false,
        statusCode: 409,
        error: 'app_required',
        message:
          'Multiple React Native apps are connected. Pass ?appId=<id> to select one.',
        devices,
      };
    }

    return { ok: true, device: devices[0] };
  }

  #getContext(context?: PluginEndpointContext): PluginEndpointContext | null {
    if (context) {
      this.attach(context);
      return context;
    }
    return this.#context;
  }
}

function toElementInspectorDevice(target: {
  appId: string;
  name: string;
  connected: boolean;
  connectedAt: number;
  hasDebugger: boolean;
}): ElementInspectorDevice {
  return {
    appId: target.appId,
    name: target.name,
    connected: target.connected,
    connectedAt: target.connectedAt,
    hasDebugger: target.hasDebugger,
  };
}

function parseSnapshot(value: unknown): ElementInspectorSnapshot | null {
  const snapshotValue = typeof value === 'string' ? parseJson(value) : value;
  if (!snapshotValue || typeof snapshotValue !== 'object') {
    return null;
  }

  const snapshot = snapshotValue as Partial<ElementInspectorSnapshot>;
  if (
    typeof snapshot.requestId !== 'string' ||
    typeof snapshot.requestedAt !== 'number' ||
    typeof snapshot.capturedAt !== 'number' ||
    !isSnapshotStatus(snapshot.status)
  ) {
    return null;
  }

  return snapshot as ElementInspectorSnapshot;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isSnapshotStatus(value: unknown): boolean {
  return value === 'ok' || value === 'unsupported' || value === 'error';
}

function isSameDevice(
  expected: ElementInspectorDevice,
  actual: ElementInspectorDevice
): boolean {
  return expected.appId === actual.appId;
}
