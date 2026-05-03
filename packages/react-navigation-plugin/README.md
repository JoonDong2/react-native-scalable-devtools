# @react-native-scalable-devtools/react-navigation-plugin

[한국어](README.ko.md)

This plugin exposes host-side endpoints that let an external agent read registered React Navigation state, navigate to a route, or go back in a running React Native app. It can also patch the React Native debugger frontend with a Navigation tab that shows the registered navigation state live.

The plugin owns React Navigation ref registration. It does not inspect the UI tree or trigger view actions; use `@react-native-scalable-devtools/element-inspector-plugin` for observation and `@react-native-scalable-devtools/agent-actions-plugin` for press and scroll actions.

## Usage

### Register the plugin

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  patchDebuggerFrontend,
  reactNavigationPlugin,
} = require('@react-native-scalable-devtools/react-navigation-plugin');

module.exports = {
  commands: [
    startCommand(reactNavigationPlugin({ patchDebuggerFrontend })),
  ],
};
```

You can register it next to other plugins when an agent workflow needs both screen navigation and UI actions:

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
      agentActionsPlugin(),
    ),
  ],
};
```

### Register a React Navigation ref

The plugin cannot discover your navigation container by itself. Create the navigation ref in the app and register it with the client entry.

```ts
import { createNavigationContainerRef } from '@react-navigation/native';
import { registerNavigationRef } from '@react-native-scalable-devtools/react-navigation-plugin/client';

export const navigationRef = createNavigationContainerRef();

registerNavigationRef(navigationRef);
```

```tsx
<NavigationContainer ref={navigationRef}>
  {/* screens */}
</NavigationContainer>
```

The plugin accepts any ref with the React Navigation-style methods it needs, so it does not import `@react-navigation/native` directly.

## Debugger frontend tab

Passing `patchDebuggerFrontend` to `reactNavigationPlugin` adds a `Navigation` tab to the React Native debugger frontend. The tab registers a custom `ReactNavigation` CDP domain and sends `ReactNavigation.enable`, `ReactNavigation.getState`, and `ReactNavigation.disable` through the existing debugger socket. The devtools server routes those commands to the app that is already bound to that debugger session, using the same app socket mapping as the network plugin.

When the tab is enabled, the app runtime listens to the registered navigation ref and emits `ReactNavigation.stateUpdated` whenever the navigation state changes. The panel renders the root history as a route list, expands nested navigator routes such as stacks, and opens a closable detail pane with `name`, `key`, and `params` when a route is selected. The event includes `updatedAt` and a state snapshot with `isReady`, sanitized root `state`, and `currentRoute`. A short polling fallback is used for navigation refs that do not expose a `state` listener.

## Endpoints

Use `GET /apps` from the core package first when multiple apps are connected, then pass the selected `appId`.

```sh
curl -s "http://localhost:8081/apps"
```

### Navigate

```sh
curl -s -X POST "http://localhost:8081/react-navigation/navigate" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","name":"Settings","params":{"tab":"profile"}}'
```

The runtime calls the registered `navigationRef.navigate(...)`. The request body can either pass `name`, `params`, `key`, `path`, and `merge` at the top level or inside a `navigation` object.

### Go back

```sh
curl -s -X POST "http://localhost:8081/react-navigation/back" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>"}'
```

If the registered ref exposes `canGoBack()`, the plugin checks it before calling `goBack()`.

### Get navigation state

```sh
curl -s "http://localhost:8081/react-navigation/state?appId=<appId>"
```

The endpoint asks the app runtime for the registered React Navigation ref and returns a result whose `value` contains `isReady`, the sanitized root navigation `state`, and `currentRoute`. It does not add derived screen summaries; agents can read React Navigation's own `index` and `routes` structure from `result.value.state`.

Example response:

```json
{
  "ok": true,
  "device": {
    "appId": "app-1",
    "name": "iPhone 15",
    "connected": true,
    "connectedAt": 1710000000000,
    "hasDebugger": true
  },
  "result": {
    "requestId": "req-1",
    "requestedAt": 1710000000100,
    "completedAt": 1710000000120,
    "action": "getNavigationState",
    "status": "ok",
    "value": {
      "isReady": true,
      "state": {
        "index": 1,
        "routeNames": ["Home", "Settings"],
        "routes": [
          { "key": "Home-a1", "name": "Home" },
          { "key": "Settings-b2", "name": "Settings" }
        ]
      },
      "currentRoute": {
        "key": "Settings-b2",
        "name": "Settings"
      }
    }
  }
}
```

## Notes

This plugin is for development and agent automation workflows. It performs semantic JavaScript navigation through a registered React Navigation ref. It does not simulate native taps, gestures, or OS-level back behavior.

Use `@react-native-scalable-devtools/agent-actions-plugin` when an agent needs to press a matched React Native view or scroll a matched container.
