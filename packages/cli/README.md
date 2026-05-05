# @react-native-scalable-devtools/cli

[한국어](README.ko.md)

`@react-native-scalable-devtools/cli` is the core package in this monorepo. It provides the server that connects to React Native apps, exposes debugger endpoints, and gives plugins a shared surface for extending the debugger experience.

## Overview

This package is the starting point for the debugger stack.

It provides:

- a replacement `startCommand` for launching the debugger server
- an AppProxy that tracks connected React Native apps
- a public `appId` selector for routing requests to the right app
- the plugin API used by the network, element inspector, React Navigation, and Tanstack Query plugins
- hooks for custom HTTP endpoints, WebSocket endpoints, and debugger protocol behavior

If you are building a debugger workflow for one app or many apps, this package is the layer that keeps the connection model and plugin integration in one place.

## Why It Exists

React Native's stock debugging setup is useful for basic inspection, but it gets limiting once you need a more controlled workflow.

This package exists because:

- the built-in React Native network panel does not track socket traffic
- the stock frontend does not provide a socket-specific filter
- some projects need to customize the debugger frontend without forking the whole stack
- element-tree inspection lets the host observe the running app's UI hierarchy directly

The goal is to keep the core debugger small, extensible, and predictable while letting focused plugins add specialized behavior.

## Usage

### Start the debugger server

The simplest usage is to install the package, import `startCommand`, and register plugins.

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
} = require('@react-native-scalable-devtools/tanstack-query-plugin');

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
    ),
  ],
};
```

### Work with connected apps

The server exposes `GET /apps` so external tools can discover the connected React Native apps and the `appId` values that should be used with plugin endpoints.

```sh
curl -s "http://localhost:8081/apps"
```

`appId` is the public selector for debugger requests. The `deviceInfo.deviceId` field is kept as metadata for tools that need the native device identifier, but it is not the routing key for the debugger.

### Inspect the current element tree

The element inspector plugin exposes `GET /element-inspector`.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

The first request can be noticeably slower than later requests. The server may need to inject client-side plugin code, wait for the app runtime to attach, and measure the React tree before it can return the first snapshot. Keep this in mind when setting agent or test timeouts.

Use `GET /apps` first, then pass the chosen `appId`. If only one app is connected, `appId` can be omitted. If more than one app is connected, the endpoint requires `appId` so the request reaches the right runtime.

You can use it like this: the plugin reads the React tree, turns it into a layout tree, and returns a result that a test agent can evaluate directly.

![Element inspector flow](./element-inspector.png)

The element inspector plugin helps reduce token and context usage by letting you select a root node, flatten wrapper nodes, or convert the tree into plain text before handing it to an agent.

From the host, you can inspect the live element tree without attaching a visual debugger or taking a screenshot first.

Useful query parameters:

- `start`: choose a component name as the root of the response
- `compact=1`: reduce noise by removing zero-size nodes and flattening simple wrapper pairs
- `plain=1`: return an indented `text/plain` tree instead of JSON
- `layoutPrecision`: control decimal precision for layout values
- `nodeId`: pass `1` to include node ids in compact/plain output, or `0` to remove node ids from JSON output

The response is generated on demand, so it reflects the current UI tree when the request arrives.

### Customize the debugger frontend

The base debugger frontend is configured on `startCommand`, not inside a single plugin.

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-devtools/network-plugin');

module.exports = {
  commands: [
    startCommand(
      {
        debuggerFrontend: {
          path: '/absolute/path/to/custom/third-party/front_end',
          sourceDist: '/absolute/path/to/@react-native/debugger-frontend/dist',
        },
      },
      networkPanelPlugin({ patchDebuggerFrontend }),
    ),
  ],
};
```

If you do not provide a custom frontend, the server resolves `@react-native/debugger-frontend` from the consuming React Native project and applies any plugin patches to that frontend.

## Plugins

The core package is intentionally small. The special behavior lives in plugins so you can add only what your project needs.

### `@react-native-scalable-devtools/network-plugin`

Use this plugin when you need better network visibility than the default React Native debugger gives you.

It is useful because:

- it adds instrumentation for HTTP and WebSocket traffic
- it contributes to the CDP `Network` domain so traffic can be inspected from the debugger
- it can patch the debugger frontend so socket traffic appears as its own WebSocket category/filter in the network panel

In short, this plugin is the network layer for debugging apps that talk to servers, sockets, or streaming APIs.

### `@react-native-scalable-devtools/element-inspector-plugin`

Use this plugin when you need a live view of the React Native element tree.

It is useful because:

- tools can request the current UI hierarchy from a running app
- the output can be returned as JSON or as plain text
- the tree can be compacted to reduce noise when only the important nodes matter
- the response can be re-rooted to focus on a specific component

This plugin is a good fit for MCP servers, test agents, and custom scripts that need to inspect the app UI without relying on screenshots alone.

The image is stored next to this README for documentation only. It is not listed in the package `files`, so it is not included in the published npm package.

### `@react-native-scalable-devtools/react-navigation-plugin`

Use this plugin when an external agent needs to register a React Navigation `navigationRef` and inspect navigation state live in the debugger frontend.

It is useful because:

- it keeps React Navigation-specific behavior out of generic UI actions
- it lets apps register a React Navigation `navigationRef` for agent-driven state observation
- it can patch the React Native debugger frontend with a live `Navigation` tab using the existing app socket mapping
- it keeps navigation-specific UI out of the host-side HTTP surface

This plugin performs JavaScript semantic navigation through React Navigation. It does not simulate native gestures or OS-level back behavior.

### `@react-native-scalable-devtools/tanstack-query-plugin`

Use this plugin when you need to inspect a registered Tanstack Query or TanStack Query `QueryClient` from the debugger frontend or from a host-side endpoint.

It is useful because:

- apps register their own `QueryClient` directly from runtime code
- it observes query cache changes in real time
- it exposes host-side `/react-query/queries` snapshots
- it can patch the React Native debugger frontend with a live `Queries` tab using the existing app socket mapping
- selecting a query key opens a closable detail pane with the query data and state

This plugin observes query keys and data. It does not mutate query data, invalidate queries, or trigger refetches.

### Creating your own plugin

You can extend the debugger by implementing `ScalableDebuggerPlugin`.

```typescript
import type { ScalableDebuggerPlugin } from '@react-native-scalable-devtools/cli';

export const myCustomPlugin = (): ScalableDebuggerPlugin => ({
  name: 'my-custom-plugin',

  clientEntries: [
    { importPath: require.resolve('./client/my-plugin-client') },
  ],

  middlewareEndpoints: [
    {
      path: '/my-custom-endpoint',
      handler: (req, res, context, next) => {
        const apps = context.socketContext.listAppConnections();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apps: apps.length }));
      },
    },
  ],

  websocketEndpoints: [
    {
      path: '/my-custom-ws',
      server: (req, context) => myWebSocketServerInstance,
    },
  ],

  domains: [
    (context) => ({
      domainName: 'MyCustomDomain',
      handleDebuggerMessage: (payload) => {
        if (payload.method === 'MyCustomDomain.enable') {
          return true;
        }
      },
      handleDeviceMessage: (payload) => {},
    }),
  ],
});
```

Plugin capabilities:

- `clientEntries`: inject client-side code into the React Native app when it connects
- `middlewareEndpoints`: add custom HTTP endpoints on the Metro server
- `websocketEndpoints`: add custom WebSocket servers on the Metro server
- `domains`: intercept or add Chrome DevTools Protocol domains

## Existing Endpoint Notes

The package still exposes the same core behavior as before:

- `GET /apps` returns connected apps and their metadata
- `GET /element-inspector` requests a fresh tree snapshot from the app runtime
- `appId` remains the public selector for external requests
- `deviceInfo.deviceId` stays available for tools that need the underlying device id
