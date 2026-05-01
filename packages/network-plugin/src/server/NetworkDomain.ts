import type {
  InspectorDomainContribution,
  InspectorDomainContext,
} from '@react-native-scalable-devtools/cli/plugin';
import type { CDPMessage } from '../types/cdp';

export class NetworkDomain implements InspectorDomainContribution {
  readonly domainName = 'Network';
  #context: InspectorDomainContext;

  constructor(context: InspectorDomainContext) {
    this.#context = context;
  }

  handleDeviceMessage(_payload: CDPMessage): boolean {
    return true;
  }

  handleDebuggerMessage(payload: CDPMessage): boolean {
    if (payload.method === 'Network.getResponseBody') {
      this.#context.socketContext.sendToApp(
        this.#context.connection.debugger,
        payload
      );
      return true;
    }

    if (payload.method === 'Network.enable' || payload.method === 'Network.disable') {
      return true;
    }

    return true;
  }
}

export function createNetworkDomain(
  context: InspectorDomainContext
): InspectorDomainContribution {
  return new NetworkDomain(context);
}
