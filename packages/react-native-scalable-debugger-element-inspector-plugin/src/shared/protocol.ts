export const ELEMENT_INSPECTOR_ENDPOINT = '/element-inspector';
export const ELEMENT_INSPECTOR_GET_TREE_METHOD = 'ElementInspector.getTree';
export const ELEMENT_INSPECTOR_SNAPSHOT_METHOD = 'ElementInspector.snapshot';

export type ElementInspectorStatus = 'ok' | 'unsupported' | 'error';

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface ElementInspectorDevice {
  appId: string;
  nativeAppId?: string;
  name: string;
  connected: boolean;
  connectedAt: number;
  hasDebugger: boolean;
}

export interface ElementInspectorSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface ElementInspectorLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInspectorNode {
  id: string;
  type: string;
  displayName?: string;
  text?: string;
  props?: Record<string, JSONValue>;
  layout?: ElementInspectorLayout;
  source?: ElementInspectorSource;
  children?: ElementInspectorNode[];
  warnings?: string[];
}

export interface ElementInspectorSnapshot extends Record<string, unknown> {
  requestId: string;
  requestedAt: number;
  capturedAt: number;
  status: ElementInspectorStatus;
  root?: ElementInspectorNode;
  reason?: string;
  warnings?: string[];
}

export interface ElementInspectorGetTreeParams extends Record<string, unknown> {
  requestId: string;
  requestedAt: number;
}

export interface ElementInspectorSnapshotMessageParams
  extends ElementInspectorSnapshot {}

export interface ElementInspectorSuccessResponse {
  ok: true;
  device: ElementInspectorDevice;
  snapshot: ElementInspectorSnapshot;
}

export interface ElementInspectorErrorResponse {
  ok: false;
  error: string;
  message: string;
  devices?: ElementInspectorDevice[];
}

export type ElementInspectorResponse =
  | ElementInspectorSuccessResponse
  | ElementInspectorErrorResponse;
