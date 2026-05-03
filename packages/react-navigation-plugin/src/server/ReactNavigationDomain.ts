import type {
  InspectorDomainContribution,
  InspectorDomainContext,
} from '@react-native-scalable-devtools/cli/plugin';
import {
  REACT_NAVIGATION_CDP_DISABLE_METHOD,
  REACT_NAVIGATION_CDP_DOMAIN,
  REACT_NAVIGATION_CDP_ENABLE_METHOD,
  REACT_NAVIGATION_CDP_GET_STATE_METHOD,
} from '../shared/protocol';

type CDPMessage = Parameters<
  NonNullable<InspectorDomainContribution['handleDebuggerMessage']>
>[0];

const SUPPORTED_DEBUGGER_METHODS = new Set([
  REACT_NAVIGATION_CDP_ENABLE_METHOD,
  REACT_NAVIGATION_CDP_DISABLE_METHOD,
  REACT_NAVIGATION_CDP_GET_STATE_METHOD,
]);

type AppSelection =
  | { ok: true; appId: string }
  | { ok: false; message: string };

export class ReactNavigationDomain implements InspectorDomainContribution {
  readonly domainName = REACT_NAVIGATION_CDP_DOMAIN;
  #context: InspectorDomainContext;

  constructor(context: InspectorDomainContext) {
    this.#context = context;
  }

  handleDebuggerMessage(payload: CDPMessage): boolean {
    if (!payload.method || !SUPPORTED_DEBUGGER_METHODS.has(payload.method)) {
      this.#sendError(
        payload.id,
        `Unsupported React Navigation debugger method: ${payload.method ?? 'unknown'}`
      );
      return true;
    }

    const selection = this.#selectApp();
    if (!selection.ok) {
      this.#sendError(payload.id, selection.message);
      return true;
    }

    const sent = this.#context.socketContext.sendToApp(
      this.#context.connection.debugger,
      payload
    );

    if (!sent) {
      this.#sendError(
        payload.id,
        `No active React Native app connection found for appId "${selection.appId}".`
      );
    }

    return true;
  }

  #selectApp(): AppSelection {
    const mappedAppId = this.#context.socketContext.getAppId(
      this.#context.connection.debugger
    );

    if (!mappedAppId) {
      return {
        ok: false,
        message:
          'Waiting for this debugger session to connect to a React Native app.',
      };
    }

    return this.#context.socketContext.getAppConnectionById(mappedAppId)
      ? { ok: true, appId: mappedAppId }
      : {
          ok: false,
          message: `No active React Native app connection found for appId "${mappedAppId}".`,
        };
  }

  #sendError(id: number | undefined, message: string): void {
    if (typeof id !== 'number') {
      return;
    }

    this.#context.connection.debugger.sendMessage({
      id,
      error: {
        code: -32000,
        message,
      },
    });
  }
}

export function createReactNavigationDomain(
  context: InspectorDomainContext
): InspectorDomainContribution {
  return new ReactNavigationDomain(context);
}
