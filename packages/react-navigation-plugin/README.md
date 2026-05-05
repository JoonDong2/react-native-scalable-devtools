# @react-native-scalable-devtools/react-navigation-plugin

[한국어](README.ko.md)

This plugin patches the React Native debugger frontend with a Navigation tab that shows the registered navigation state live.

The plugin owns React Navigation ref registration. It does not inspect the UI tree or trigger view actions; use `@react-native-scalable-devtools/element-inspector-plugin` for observation and host-side automation tools when you need native taps or scrolls.

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

You can register it next to other plugins when an agent workflow needs both navigation-state inspection and UI actions:

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

if (__DEV__) {
  registerNavigationRef(navigationRef);
}

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

## Notes

This plugin is for development and agent automation workflows. It keeps registered React Navigation state visible in the debugger frontend through a registered ref. It does not simulate native taps, gestures, or OS-level back behavior.

Use `@react-native-scalable-devtools/element-inspector-plugin` and host-side automation tools when an agent needs to inspect a React Native view and drive native taps or scrolls.
There are no host-side HTTP endpoints in this plugin.
