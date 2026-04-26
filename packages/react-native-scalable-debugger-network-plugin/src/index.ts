import type { ScalableDebuggerPlugin } from 'react-native-scalable-debugger/plugin';
import type {
  DebuggerFrontendPatch,
  RunServerOptions,
} from 'react-native-scalable-debugger';
import { createNetworkDomain } from './server/NetworkDomain';
import { preparePatchedFrontend } from './server/patchDebuggerFrontend';

export interface NetworkPanelPluginOptions {
  patchDebuggerFrontend?: DebuggerFrontendPatch;
}

const networkPanelPluginDefinition: ScalableDebuggerPlugin = {
  name: 'network-panel',
  domains: [createNetworkDomain],
  clientEntries: [
    {
      importPath: 'react-native-scalable-debugger-network-plugin/client',
    },
  ],
};

export const patchDebuggerFrontend: DebuggerFrontendPatch = ({ sourceDist }) =>
  preparePatchedFrontend(sourceDist);

export function networkPanelPlugin(
  options: NetworkPanelPluginOptions = {}
): RunServerOptions {
  return {
    plugins: [networkPanelPluginDefinition],
    debuggerFrontendPatch: options.patchDebuggerFrontend,
  };
}

export function createNetworkPanelPlugin(): ScalableDebuggerPlugin {
  return networkPanelPluginDefinition;
}

export default networkPanelPlugin;
