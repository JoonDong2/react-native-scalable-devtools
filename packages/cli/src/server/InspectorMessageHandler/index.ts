import jsonParseSafely from '../../shared/jsonParseSafely';
import { DEVICE_KEY } from '../../shared/constants';
import JSApp from './domains/JSApp';
import makeDomains from './makeDomains';
import { normalizePlugins } from '../../plugin';
import { createDebuggerSocketContext } from '../debuggerSocketContext';
import type { CDPMessage } from '../../types/cdp';
import type {
  CustomMessageHandlerConnection,
  CustomMessageHandler,
  JSONSerializable,
  ExposedDebugger,
} from '../../types/connection';
import type {
  InspectorDomainContribution,
  InspectorDomainContext,
  ScalableDebuggerPlugin,
} from '../../plugin';

const jsAppIdToConnection = new Map<string, ExposedDebugger>();

interface RuntimeConsolePayload {
  params?: {
    args?: Array<{ value?: unknown }>;
  };
}

const validJSAppMessage = (payload: CDPMessage): boolean => {
  const p = payload as RuntimeConsolePayload;
  return !!(
    p &&
    p.params &&
    Array.isArray(p.params.args) &&
    p.params.args.length === 2 &&
    p.params.args[0].value === DEVICE_KEY
  );
};

const extractOriginPayload = (payload: CDPMessage): CDPMessage | null => {
  const p = payload as RuntimeConsolePayload;
  return jsonParseSafely<CDPMessage>(p.params!.args![1].value as string);
};

interface CreateInspectorMessageHandlerOptions {
  plugins?: readonly ScalableDebuggerPlugin[];
}

const CORE_DOMAIN_NAMES = new Set(['JSApp']);

const createPluginDomainMap = (
  plugins: readonly ScalableDebuggerPlugin[],
  context: InspectorDomainContext
): Map<string, InspectorDomainContribution> => {
  const map = new Map<string, InspectorDomainContribution>();

  for (const plugin of normalizePlugins(plugins)) {
    for (const factory of plugin.domains ?? []) {
      const contributions = factory(context);
      const domainList = Array.isArray(contributions)
        ? contributions
        : [contributions];

      for (const domain of domainList) {
        const domainName = domain.domainName?.trim();
        if (!domainName) {
          throw new Error(`Plugin ${plugin.name} contributed a domain without a name.`);
        }
        if (CORE_DOMAIN_NAMES.has(domainName) || map.has(domainName)) {
          throw new Error(`Duplicate inspector domain: ${domainName}`);
        }
        map.set(domainName, domain);
      }
    }
  }

  return map;
};

const getDomainName = (method: string | undefined): string | undefined => {
  return typeof method === 'string' ? method.split('.')[0] : undefined;
};

const createInspectorMessageHandler = (
  _connection: CustomMessageHandlerConnection,
  options: CreateInspectorMessageHandlerOptions = {}
): CustomMessageHandler => {
  const connection = _connection;
  const socketContext = createDebuggerSocketContext();
  const pluginContext = { connection, socketContext };
  const domains = makeDomains([new JSApp()]);
  const pluginDomains = createPluginDomainMap(options.plugins ?? [], pluginContext);

  return {
    handleDeviceMessage: (payload: JSONSerializable): boolean | void => {
      const cdpPayload = payload as CDPMessage;
      const domain1 = domains.get(cdpPayload.method);

      if (domain1) {
        return domain1.handler(connection, cdpPayload);
      }
      const pluginDomain1 = pluginDomains.get(getDomainName(cdpPayload.method) ?? '');
      if (pluginDomain1?.handleDeviceMessage) {
        return pluginDomain1.handleDeviceMessage(cdpPayload, pluginContext);
      }

      if (!validJSAppMessage(cdpPayload)) {
        return false; // continue
      }

      const originPayload = extractOriginPayload(cdpPayload);
      if (!originPayload) {
        return true; // stop
      }

      const domain2 = domains.get(originPayload.method);

      if (domain2) {
        return domain2.handler(connection, originPayload);
      }
      const pluginDomain2 = pluginDomains.get(getDomainName(originPayload.method) ?? '');
      if (pluginDomain2?.handleDeviceMessage) {
        return pluginDomain2.handleDeviceMessage(originPayload, pluginContext);
      }

      return true; // stop
    },
    handleDebuggerMessage: (payload: JSONSerializable): boolean | void => {
      const cdpPayload = payload as CDPMessage;
      const domain = domains.get(cdpPayload.method);

      if (domain) {
        return domain.handler(connection, cdpPayload);
      }
      const pluginDomain = pluginDomains.get(getDomainName(cdpPayload.method) ?? '');
      if (pluginDomain?.handleDebuggerMessage) {
        return pluginDomain.handleDebuggerMessage(cdpPayload, pluginContext);
      }

      return false; // continue
    },
  };
};

const getDebuggerFromJSAppId = (jsAppId: string): ExposedDebugger | undefined => {
  return jsAppIdToConnection.get(jsAppId);
};

export default {
  createInspectorMessageHandler,
  getDebuggerFromJSAppId,
};
