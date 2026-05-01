import AppProxy from './AppProxy';
import type { CDPMessage } from '../types/cdp';
import type { ExposedDebugger } from '../types/connection';
import type { DebuggerSocketContext } from '../plugin';

export function createDebuggerSocketContext(): DebuggerSocketContext {
  return {
    getAppId: (debuggerConnection: ExposedDebugger) =>
      AppProxy.getAppId(debuggerConnection),
    getAppConnection: (debuggerConnection: ExposedDebugger) =>
      AppProxy.getAppConnection(debuggerConnection),
    getAppConnectionById: (appId: string) =>
      AppProxy.getAppConnectionById(appId),
    listAppConnections: () => AppProxy.listAppConnections(),
    sendToApp: (
      debuggerConnection: ExposedDebugger,
      payload: CDPMessage | string
    ): boolean => {
      const appConnection = AppProxy.getAppConnection(debuggerConnection);
      if (!appConnection) {
        return false;
      }

      appConnection.sendMessage(payload);
      return true;
    },
    sendToAppById: (
      appId: string,
      payload: CDPMessage | string
    ): boolean => {
      const appConnection = AppProxy.getAppConnectionById(appId);
      if (!appConnection) {
        return false;
      }

      appConnection.sendMessage(payload);
      return true;
    },
    onAppConnected: (debuggerConnection, listener) =>
      AppProxy.addAppConnectionListener(debuggerConnection, listener),
    onAppMessage: (listener) => AppProxy.addAppMessageListener(listener),
  };
}
