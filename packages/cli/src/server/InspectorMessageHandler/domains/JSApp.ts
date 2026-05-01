import AppProxy from '../../AppProxy';
import Domain from './Domain';
import type { CDPMessage } from '../../../types/cdp';
import type { CustomMessageHandlerConnection } from '../../../types/connection';

interface SetAppIdParams {
  id: string;
}

class JSApp extends Domain {
  static domainName = 'JSApp';

  override handler = (
    connection: CustomMessageHandlerConnection,
    payload: CDPMessage
  ): boolean => {
    if (payload.method === 'JSApp.setAppId') {
      const params = payload.params as unknown as SetAppIdParams;
      const appId = params.id;
      AppProxy.setDebuggerConnection(appId, connection.debugger, {
        name: connection.device.name,
      });

      return Domain.BLOCK;
    }

    return Domain.CONTINUE;
  };
}

export default JSApp;
