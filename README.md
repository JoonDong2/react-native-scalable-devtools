# react-native-scalable-devtools

[한국어](README.ko.md)

`@react-native-scalable-devtools/cli` is the core package in this monorepo. It provides the server that connects to React Native apps, exposes debugger endpoints, and gives plugins a shared surface for extending the debugger experience.

The project is split into a small core package and focused plugins so you can use only the pieces you need.

## Overview

This repository gives you a debugger stack that is easier to extend than the default React Native setup.

It is built around:

- a core debugger server that connects to React Native apps
- a public `appId` selector for routing requests to the right app
- a plugin system for adding HTTP endpoints, WebSocket endpoints, and debugger hooks
- focused plugins for network inspection, live element-tree inspection, React Navigation control, and semantic UI actions

If you only want a quick summary: the core package starts the server, and the plugins add specialized debugging features on top of it.

## Why It Exists

React Native's built-in debugging tools are useful for basic work, but they become limiting when you need a more controlled workflow.

This monorepo exists because:

- the default network panel is not enough when you need to inspect socket traffic
- you may want to inspect the live UI hierarchy from the development host
- you may want to customize the debugger frontend without forking the whole debugger stack
- different debugging needs are easier to maintain as separate plugins than as one large package

The goal is to keep the core debugger small and predictable while letting plugins add the behavior you actually need.

## Usage

Start with the core package and register only the plugins you want.

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  networkPanelPlugin,
  patchDebuggerFrontend: patchNetworkDebuggerFrontend,
} = require('@react-native-scalable-devtools/network-plugin');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');
const {
  patchDebuggerFrontend: patchReactNavigationDebuggerFrontend,
  reactNavigationPlugin,
} = require('@react-native-scalable-devtools/react-navigation-plugin');
const {
  patchDebuggerFrontend: patchReactQueryDebuggerFrontend,
  reactQueryPlugin,
} = require('@react-native-scalable-devtools/react-query-plugin');
const {
  agentActionsPlugin,
} = require('@react-native-scalable-devtools/agent-actions-plugin');

module.exports = {
  commands: [
    startCommand(
      networkPanelPlugin({
        patchDebuggerFrontend: patchNetworkDebuggerFrontend,
      }),
      elementInspectorPlugin(),
      reactNavigationPlugin({
        patchDebuggerFrontend: patchReactNavigationDebuggerFrontend,
      }),
      reactQueryPlugin({
        patchDebuggerFrontend: patchReactQueryDebuggerFrontend,
      }),
      agentActionsPlugin(),
    ),
  ],
};
```

Useful endpoints:

- `GET /apps` from `@react-native-scalable-devtools/cli` to discover connected apps, their `appId` values, and the device identifier the host OS recognizes for each app
- `GET /element-inspector` from `@react-native-scalable-devtools/element-inspector-plugin` to fetch the live element tree for a connected app
- `GET /react-navigation/state`, `POST /react-navigation/navigate`, and `POST /react-navigation/back` from `@react-native-scalable-devtools/react-navigation-plugin` to let an external agent read registered React Navigation state and move through screens
- `GET /react-query/queries` from `@react-native-scalable-devtools/react-query-plugin` to let an external agent read registered QueryClient cache data
- `POST /agent-actions/press` and `POST /agent-actions/scroll` from `@react-native-scalable-devtools/agent-actions-plugin` to let an external agent press a matched view or scroll a matched container
- The React Navigation plugin can also patch the debugger frontend with a live `Navigation` tab backed by a custom `ReactNavigation` CDP domain over the existing app socket mapping
- The React Query plugin can patch the debugger frontend with a live `Queries` tab backed by a custom `ReactQuery` CDP domain over the existing app socket mapping

If only one app is connected, `appId` can usually be omitted. If more than one app is connected, pass `appId` so the request reaches the intended runtime.

The `deviceInfo.deviceId` field from `GET /apps` is useful when you want to target a specific device with tools such as Maestro CLI, then capture a layout tree snapshot with the [element inspector plugin](packages/element-inspector-plugin/README.md) for that exact app state.

## Packages

- `@react-native-scalable-devtools/cli`: the core debugger server. It provides `startCommand`, the AppProxy that tracks connected apps, and the plugin API for custom endpoints and debugger hooks. See [package README](packages/cli/README.md).
- `@react-native-scalable-devtools/network-plugin`: the network inspection plugin. Use it when you need better visibility into HTTP requests and WebSocket traffic than the stock React Native network panel provides. It also patches the debugger frontend so socket traffic can be shown separately from Fetch/XHR traffic. See [package README](packages/network-plugin/README.md).
- `@react-native-scalable-devtools/element-inspector-plugin`: the live element-tree inspection plugin. Use it when you want to inspect the current React Native UI hierarchy from the development host, compact the tree, render it as plain text for an agent or script, or capture a snapshot after driving the app into a specific state with a host-side tool such as Maestro CLI. See [package README](packages/element-inspector-plugin/README.md).
- `@react-native-scalable-devtools/react-navigation-plugin`: the React Navigation plugin. Use it when an external LLM agent needs to read registered React Navigation state, navigate through React Navigation with a registered `navigationRef`, go back, or inspect navigation state live in the debugger frontend. See [package README](packages/react-navigation-plugin/README.md).
- `@react-native-scalable-devtools/react-query-plugin`: the React Query plugin. Use it when you need to register a QueryClient, observe query keys and data changes in real time, or inspect query data in the debugger frontend. See [package README](packages/react-query-plugin/README.md).
- `@react-native-scalable-devtools/agent-actions-plugin`: the agent action plugin. Use it when an external LLM agent needs to resolve current UI targets, press a matched view, or scroll a matched container. See [package README](packages/agent-actions-plugin/README.md).

## Package Docs

Each package has its own README with more detail:

- [Core package README](packages/cli/README.md)
- [Network plugin README](packages/network-plugin/README.md)
- [Element inspector plugin README](packages/element-inspector-plugin/README.md)
- [React Navigation plugin README](packages/react-navigation-plugin/README.md)
- [React Query plugin README](packages/react-query-plugin/README.md)
- [Agent actions plugin README](packages/agent-actions-plugin/README.md)
