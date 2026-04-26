import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { CDPMessage } from '../types/cdp';
import type {
  AppConnection,
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
  sendToApp: (
    debuggerConnection: ExposedDebugger,
    payload: CDPMessage | string
  ) => boolean;
  onAppConnected: (
    debuggerConnection: ExposedDebugger,
    listener: ConnectionListener
  ) => () => void;
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

export interface DebuggerFrontendContribution {
  resolvePath: () => string | null | Promise<string | null>;
}

export interface WebSocketEndpointContribution {
  path: string;
  server:
    | WebSocketServer
    | ((
        request: IncomingMessage
      ) => WebSocketServer | null | undefined | Promise<WebSocketServer | null | undefined>);
}

export interface ScalableDebuggerPlugin {
  name: string;
  domains?: readonly InspectorDomainFactory[];
  clientEntries?: readonly (string | ClientEntryContribution)[];
  debuggerFrontend?: DebuggerFrontendContribution;
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
