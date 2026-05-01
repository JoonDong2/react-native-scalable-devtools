import type { PluginEndpointContext } from '@react-native-scalable-devtools/cli/plugin';
import type {
  ElementInspectorDevice,
  ElementInspectorErrorResponse,
  ElementInspectorGetTreeParams,
  ElementInspectorSnapshot,
  ElementInspectorSuccessResponse,
} from '@react-native-scalable-devtools/element-inspector-plugin';
import {
  AGENT_ACTIONS_PERFORM_METHOD,
  AGENT_ACTIONS_RESULT_METHOD,
  ELEMENT_INSPECTOR_GET_TREE_METHOD,
  ELEMENT_INSPECTOR_SNAPSHOT_METHOD,
  type AgentActionDevice,
  type AgentActionErrorResponse,
  type AgentActionName,
  type AgentActionPerformParams,
  type AgentActionResult,
  type AgentActionSuccessResponse,
  type AgentActionTarget,
  type AgentNavigationCommand,
  type AgentScrollCommand,
} from '../shared/protocol';
import { createRequestId } from './createRequestId';

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 60000;

interface AppProxyMessage {
  method?: string;
  params?: unknown;
}

export interface RequestOptions {
  appId?: string;
  timeoutMs?: number;
}

export interface RuntimeActionOptions extends RequestOptions {
  action: AgentActionName;
  target?: AgentActionTarget;
  navigation?: AgentNavigationCommand;
  scroll?: AgentScrollCommand;
}

export interface ControllerActionSuccess extends AgentActionSuccessResponse {
  statusCode: number;
}

export interface ControllerActionError extends AgentActionErrorResponse {
  statusCode: number;
}

export type ControllerActionResult =
  | ControllerActionSuccess
  | ControllerActionError;

export interface ControllerSnapshotSuccess
  extends ElementInspectorSuccessResponse {
  statusCode: number;
}

export interface ControllerSnapshotError extends ElementInspectorErrorResponse {
  statusCode: number;
}

export type ControllerSnapshotResult =
  | ControllerSnapshotSuccess
  | ControllerSnapshotError;

interface PendingActionRequest {
  device: AgentActionDevice;
  resolve: (result: ControllerActionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSnapshotRequest {
  device: ElementInspectorDevice;
  resolve: (result: ControllerSnapshotResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentActionsController {
  #context: PluginEndpointContext | null = null;
  #detachAppMessageListener: (() => void) | null = null;
  #pendingActions = new Map<string, PendingActionRequest>();
  #pendingSnapshots = new Map<string, PendingSnapshotRequest>();

  attach(context: PluginEndpointContext): void {
    if (this.#context === context) {
      return;
    }

    this.#detachAppMessageListener?.();
    this.#context = context;
    this.#detachAppMessageListener = context.socketContext.onAppMessage(
      (payload, target) => {
        this.handleAppMessage(payload, toAgentActionDevice(target));
      }
    );
  }

  listDevices(context?: PluginEndpointContext): AgentActionDevice[] {
    const activeContext = this.#getContext(context);
    if (!activeContext) {
      return [];
    }

    return activeContext.socketContext
      .listAppConnections()
      .map(toAgentActionDevice);
  }

  requestSnapshot(
    context: PluginEndpointContext,
    options: RequestOptions = {}
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
    const timeoutMs = normalizeTimeout(options.timeoutMs);

    return new Promise<ControllerSnapshotResult>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingSnapshots.delete(requestId);
        resolve({
          ok: false,
          statusCode: 504,
          error: 'snapshot_timeout',
          message: `Timed out waiting for an element snapshot after ${timeoutMs}ms.`,
          devices: this.listDevices(context).map(toElementInspectorDevice),
        });
      }, timeoutMs);

      this.#pendingSnapshots.set(requestId, {
        device: toElementInspectorDevice(selection.device),
        resolve,
        timer,
      });

      const sent = context.socketContext.sendToAppById(selection.device.appId, {
        method: ELEMENT_INSPECTOR_GET_TREE_METHOD,
        params,
      });

      if (!sent) {
        clearTimeout(timer);
        this.#pendingSnapshots.delete(requestId);
        resolve({
          ok: false,
          statusCode: 503,
          error: 'device_unavailable',
          message: `No active app connection found for appId "${selection.device.appId}".`,
          devices: this.listDevices(context).map(toElementInspectorDevice),
        });
      }
    });
  }

  requestRuntimeAction(
    context: PluginEndpointContext,
    options: RuntimeActionOptions
  ): Promise<ControllerActionResult> {
    this.attach(context);

    const selection = this.#selectApp(options.appId);
    if (!selection.ok) {
      return Promise.resolve(selection);
    }

    const requestId = createRequestId();
    const requestedAt = Date.now();
    const params: AgentActionPerformParams = {
      requestId,
      requestedAt,
      action: options.action,
      target: options.target,
      navigation: options.navigation,
      scroll: options.scroll,
    };
    const timeoutMs = normalizeTimeout(options.timeoutMs);

    return new Promise<ControllerActionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingActions.delete(requestId);
        resolve({
          ok: false,
          statusCode: 504,
          error: 'action_timeout',
          message: `Timed out waiting for agent action "${options.action}" after ${timeoutMs}ms.`,
          devices: this.listDevices(context),
        });
      }, timeoutMs);

      this.#pendingActions.set(requestId, {
        device: selection.device,
        resolve,
        timer,
      });

      const sent = context.socketContext.sendToAppById(selection.device.appId, {
        method: AGENT_ACTIONS_PERFORM_METHOD,
        params,
      });

      if (!sent) {
        clearTimeout(timer);
        this.#pendingActions.delete(requestId);
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

  handleAppMessage(payload: AppProxyMessage, target: AgentActionDevice): void {
    if (payload.method === AGENT_ACTIONS_RESULT_METHOD) {
      this.#handleActionResult(payload.params, target);
      return;
    }

    if (payload.method === ELEMENT_INSPECTOR_SNAPSHOT_METHOD) {
      this.#handleSnapshot(payload.params, toElementInspectorDevice(target));
    }
  }

  #handleActionResult(params: unknown, target: AgentActionDevice): void {
    const result = parseActionResult(params);
    if (!result) {
      return;
    }

    const pending = this.#pendingActions.get(result.requestId);
    if (!pending || !isSameDevice(pending.device, target)) {
      return;
    }

    clearTimeout(pending.timer);
    this.#pendingActions.delete(result.requestId);
    pending.resolve({
      ok: true,
      statusCode: result.status === 'ok' ? 200 : 422,
      device: target,
      result,
    });
  }

  #handleSnapshot(params: unknown, target: ElementInspectorDevice): void {
    const snapshot = parseSnapshot(params);
    if (!snapshot) {
      return;
    }

    const pending = this.#pendingSnapshots.get(snapshot.requestId);
    if (!pending || !isSameDevice(pending.device, target)) {
      return;
    }

    clearTimeout(pending.timer);
    this.#pendingSnapshots.delete(snapshot.requestId);
    pending.resolve({
      ok: true,
      statusCode: 200,
      device: target,
      snapshot,
    });
  }

  #selectApp(
    requestedAppId?: string
  ): { ok: true; device: AgentActionDevice } | ControllerActionError {
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
          'Multiple React Native apps are connected. Pass appId to select one.',
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

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value!)));
}

function toAgentActionDevice(target: {
  appId: string;
  name: string;
  connected: boolean;
  connectedAt: number;
  hasDebugger: boolean;
}): AgentActionDevice {
  return {
    appId: target.appId,
    name: target.name,
    connected: target.connected,
    connectedAt: target.connectedAt,
    hasDebugger: target.hasDebugger,
  };
}

function toElementInspectorDevice(
  target: AgentActionDevice
): ElementInspectorDevice {
  return {
    appId: target.appId,
    name: target.name,
    connected: target.connected,
    connectedAt: target.connectedAt,
    hasDebugger: target.hasDebugger,
  };
}

function parseActionResult(value: unknown): AgentActionResult | null {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const result = parsed as Partial<AgentActionResult>;
  if (
    typeof result.requestId !== 'string' ||
    typeof result.requestedAt !== 'number' ||
    typeof result.completedAt !== 'number' ||
    typeof result.action !== 'string' ||
    !isActionStatus(result.status)
  ) {
    return null;
  }

  return result as AgentActionResult;
}

function parseSnapshot(value: unknown): ElementInspectorSnapshot | null {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const snapshot = parsed as Partial<ElementInspectorSnapshot>;
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

function isActionStatus(value: unknown): boolean {
  return value === 'ok' || value === 'unsupported' || value === 'error';
}

function isSnapshotStatus(value: unknown): boolean {
  return value === 'ok' || value === 'unsupported' || value === 'error';
}

function isSameDevice(
  a: { appId: string },
  b: { appId: string }
): boolean {
  return a.appId === b.appId;
}
