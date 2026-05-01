import type { WebSocketServer } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { CDPMessage } from '../types/cdp';
import type {
  AppConnection,
  AppMessageListener,
  ConnectedAppTarget,
  ConnectionListener,
  CustomMessageHandlerConnection,
  ExposedDebugger,
  JSONSerializable,
} from '../types/connection';

export type InspectorMessageDisposition = boolean | void;

export interface DebuggerSocketContext {
  getAppId: (debuggerConnection: ExposedDebugger) => string | undefined;
  getAppConnection: (
    debuggerConnection: ExposedDebugger
  ) => AppConnection | undefined;
  getAppConnectionById: (appId: string) => AppConnection | undefined;
  listAppConnections: () => readonly ConnectedAppTarget[];
  sendToApp: (
    debuggerConnection: ExposedDebugger,
    payload: CDPMessage | string
  ) => boolean;
  sendToAppById: (
    appId: string,
    payload: CDPMessage | string
  ) => boolean;
  onAppConnected: (
    debuggerConnection: ExposedDebugger,
    listener: ConnectionListener
  ) => () => void;
  onAppMessage: (listener: AppMessageListener) => () => void;
}

export interface InspectorDomainContext {
  connection: CustomMessageHandlerConnection;
  socketContext: DebuggerSocketContext;
}

export interface InspectorDomainContribution {
  domainName: string;
  handleDeviceMessage?: (
    payload: CDPMessage,
    context: InspectorDomainContext
  ) => InspectorMessageDisposition;
  handleDebuggerMessage?: (
    payload: CDPMessage,
    context: InspectorDomainContext
  ) => InspectorMessageDisposition;
}

export type InspectorDomainFactory = (
  context: InspectorDomainContext
) => InspectorDomainContribution | readonly InspectorDomainContribution[];

export interface ClientEntryContribution {
  importPath: string;
}

export interface WebSocketEndpointContribution {
  path: string;
  server:
    | WebSocketServer
    | ((
        request: IncomingMessage,
        context: PluginEndpointContext
      ) => WebSocketServer | null | undefined | Promise<WebSocketServer | null | undefined>);
}

export type MiddlewareNext = () => void;

export interface PluginEndpointContext {
  socketContext: DebuggerSocketContext;
}

export interface MiddlewareEndpointContribution {
  path: string;
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    context: PluginEndpointContext,
    next: MiddlewareNext
  ) => void | Promise<void>;
}

export interface ScalableDebuggerPlugin {
  name: string;
  domains?: readonly InspectorDomainFactory[];
  clientEntries?: readonly (string | ClientEntryContribution)[];
  middlewareEndpoints?: readonly MiddlewareEndpointContribution[];
  websocketEndpoints?: readonly WebSocketEndpointContribution[];
  handleDeviceMessage?: (
    payload: JSONSerializable,
    context: InspectorDomainContext
  ) => InspectorMessageDisposition;
  handleDebuggerMessage?: (
    payload: JSONSerializable,
    context: InspectorDomainContext
  ) => InspectorMessageDisposition;
}

export interface NormalizedScalableDebuggerPlugin
  extends Omit<ScalableDebuggerPlugin, 'clientEntries'> {
  clientEntries: readonly ClientEntryContribution[];
}
