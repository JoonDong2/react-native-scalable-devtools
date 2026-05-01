import type { ScalableDebuggerPlugin } from 'react-native-scalable-debugger/plugin';
import type { RunServerOptions } from 'react-native-scalable-debugger';
import { AgentActionsController } from './server/AgentActionsController';
import { createAgentActionsMiddlewareEndpoints } from './server/createAgentActionsMiddleware';

export interface AgentActionsPluginOptions {}

const controller = new AgentActionsController();

const agentActionsPluginDefinition: ScalableDebuggerPlugin = {
  name: 'agent-actions',
  clientEntries: [
    {
      importPath: 'react-native-agent-actions-plugin/client',
    },
  ],
  middlewareEndpoints: createAgentActionsMiddlewareEndpoints(controller),
};

export function agentActionsPlugin(
  _options: AgentActionsPluginOptions = {}
): RunServerOptions {
  return {
    plugins: [agentActionsPluginDefinition],
  };
}

export function createAgentActionsPlugin(): ScalableDebuggerPlugin {
  return agentActionsPluginDefinition;
}

export * from './types';
export {
  AGENT_ACTIONS_BACK_ENDPOINT,
  AGENT_ACTIONS_ENDPOINT,
  AGENT_ACTIONS_NAVIGATE_ENDPOINT,
  AGENT_ACTIONS_NAVIGATION_STATE_ENDPOINT,
  AGENT_ACTIONS_PRESS_ENDPOINT,
  AGENT_ACTIONS_RESOLVE_VIEW_ENDPOINT,
  AGENT_ACTIONS_SCROLL_ENDPOINT,
} from './shared/protocol';
export default agentActionsPlugin;
