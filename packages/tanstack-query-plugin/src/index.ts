import type { ScalableDebuggerPlugin } from '@react-native-scalable-devtools/cli/plugin';
import type {
  DebuggerFrontendPatch,
  RunServerOptions,
} from '@react-native-scalable-devtools/cli';
import { ReactQueryController } from './server/ReactQueryController';
import { createReactQueryDomain } from './server/ReactQueryDomain';
import { createReactQueryMiddlewareEndpoints } from './server/createReactQueryMiddleware';
import { preparePatchedFrontend } from './server/patchDebuggerFrontend';

export interface ReactQueryPluginOptions {
  patchDebuggerFrontend?: DebuggerFrontendPatch;
}

const controller = new ReactQueryController();

const reactQueryPluginDefinition: ScalableDebuggerPlugin = {
  name: 'react-query',
  domains: [createReactQueryDomain],
  clientEntries: [
    {
      importPath: '@react-native-scalable-devtools/tanstack-query-plugin/client',
    },
  ],
  middlewareEndpoints: createReactQueryMiddlewareEndpoints(controller),
};

export const patchDebuggerFrontend: DebuggerFrontendPatch = ({ sourceDist }) =>
  preparePatchedFrontend(sourceDist);

export function reactQueryPlugin(
  options: ReactQueryPluginOptions = {}
): RunServerOptions {
  return {
    plugins: [reactQueryPluginDefinition],
    debuggerFrontendPatch: options.patchDebuggerFrontend,
  };
}

export function createReactQueryPlugin(): ScalableDebuggerPlugin {
  return reactQueryPluginDefinition;
}

export * from './types';
export {
  REACT_QUERY_CDP_DISABLE_METHOD,
  REACT_QUERY_CDP_DOMAIN,
  REACT_QUERY_CDP_ENABLE_METHOD,
  REACT_QUERY_CDP_GET_QUERIES_METHOD,
  REACT_QUERY_CDP_QUERIES_UPDATED_METHOD,
  REACT_QUERY_ENDPOINT,
  REACT_QUERY_QUERIES_ENDPOINT,
} from './shared/protocol';
export default reactQueryPlugin;
