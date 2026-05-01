import type { PluginEndpointContext } from '@react-native-scalable-devtools/cli/plugin';
import {
  ELEMENT_INSPECTOR_GET_TREE_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
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
      this.#pendingRequests.set(requestId, {
        device: selection.device,
        resolve,
      });

      const sent = context.socketContext.sendToAppById(selection.device.appId, {
        method: ELEMENT_INSPECTOR_GET_TREE_METHOD,
        params,
      });

      if (!sent) {
        this.#pendingRequests.delete(requestId);
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
    if (payload.method !== ELEMENT_INSPECTOR_SNAPSHOT_METHOD) {
      return;
    }

    const snapshot = parseSnapshot(payload.params);
    if (!snapshot) {
      return;
    }

    const pending = this.#pendingRequests.get(snapshot.requestId);
    if (!pending || !isSameDevice(pending.device, target)) {
      return;
    }

    this.#pendingRequests.delete(snapshot.requestId);

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
