import type { ScalableDebuggerPlugin } from '@react-native-scalable-devtools/cli/plugin';
import type { RunServerOptions } from '@react-native-scalable-devtools/cli';
import { ELEMENT_INSPECTOR_ENDPOINT } from './shared/protocol';
import { ElementInspectorController } from './server/ElementInspectorController';
import { createElementInspectorMiddleware } from './server/createElementInspectorMiddleware';
import { createElementInspectorWebSocket } from './server/createElementInspectorWebSocket';

export interface ElementInspectorPluginOptions {}

const controller = new ElementInspectorController();

const elementInspectorPluginDefinition: ScalableDebuggerPlugin = {
  name: 'element-inspector',
  clientEntries: [
    {
      importPath:
        '@react-native-scalable-devtools/element-inspector-plugin/client',
    },
  ],
  middlewareEndpoints: [
    {
      path: ELEMENT_INSPECTOR_ENDPOINT,
      handler: createElementInspectorMiddleware(controller),
    },
  ],
  websocketEndpoints: [
    {
      path: ELEMENT_INSPECTOR_ENDPOINT,
      server: createElementInspectorWebSocket(controller),
    },
  ],
};

export function elementInspectorPlugin(
  _options: ElementInspectorPluginOptions = {}
): RunServerOptions {
  return {
    plugins: [elementInspectorPluginDefinition],
  };
}

export function createElementInspectorPlugin(): ScalableDebuggerPlugin {
  return elementInspectorPluginDefinition;
}

export * from './types';
export { ELEMENT_INSPECTOR_ENDPOINT } from './shared/protocol';
export default elementInspectorPlugin;
