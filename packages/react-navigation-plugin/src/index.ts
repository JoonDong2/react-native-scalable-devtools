import type { ScalableDebuggerPlugin } from '@react-native-scalable-devtools/cli/plugin';
import type {
  DebuggerFrontendPatch,
  RunServerOptions,
} from '@react-native-scalable-devtools/cli';
import { createReactNavigationDomain } from './server/ReactNavigationDomain';
import { preparePatchedFrontend } from './server/patchDebuggerFrontend';

export interface ReactNavigationPluginOptions {
  patchDebuggerFrontend?: DebuggerFrontendPatch;
}

const reactNavigationPluginDefinition: ScalableDebuggerPlugin = {
  name: 'react-navigation',
  domains: [createReactNavigationDomain],
  clientEntries: [
    {
      importPath: '@react-native-scalable-devtools/react-navigation-plugin/client',
    },
  ],
};

export const patchDebuggerFrontend: DebuggerFrontendPatch = ({ sourceDist }) =>
  preparePatchedFrontend(sourceDist);

export function reactNavigationPlugin(
  options: ReactNavigationPluginOptions = {}
): RunServerOptions {
  return {
    plugins: [reactNavigationPluginDefinition],
    debuggerFrontendPatch: options.patchDebuggerFrontend,
  };
}

export function createReactNavigationPlugin(): ScalableDebuggerPlugin {
  return reactNavigationPluginDefinition;
}

export * from './types';
export {
  REACT_NAVIGATION_CDP_DOMAIN,
  REACT_NAVIGATION_CDP_DISABLE_METHOD,
  REACT_NAVIGATION_CDP_ENABLE_METHOD,
  REACT_NAVIGATION_CDP_GET_STATE_METHOD,
  REACT_NAVIGATION_CDP_STATE_UPDATED_METHOD,
} from './shared/protocol';
export default reactNavigationPlugin;
