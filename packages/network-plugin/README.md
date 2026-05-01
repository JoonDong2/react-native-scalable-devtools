# @react-native-scalable-devtools/network-plugin

[한국어](README.ko.md)

Network panel plugin for `@react-native-scalable-devtools/cli`.

## Why This Plugin Exists

The built-in React Native debugger network panel is not enough for this debugging workflow because it does not track WebSocket traffic as a first-class stream and it does not provide a socket-specific filter. This plugin adds app-side HTTP and WebSocket instrumentation and contributes network messages to the debugger through the CDP `Network` domain.

## Usage

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-devtools/network-plugin');

module.exports = {
  commands: [
    startCommand(networkPanelPlugin({ patchDebuggerFrontend })),
  ],
};
```

## Debugger Frontend Customization

The plugin exports `patchDebuggerFrontend` to customize the debugger frontend. The patch adds a WebSocket category/filter to the React Native debugger frontend so socket traffic appears as its own group and can be separated from Fetch/XHR traffic in the network panel.

The base debugger frontend is still configured through `startCommand`. The plugin supplies a patch function, while `startCommand` decides which frontend is used as the base.

```js
startCommand(
  {
    debuggerFrontend: {
      path: '/absolute/path/to/custom/third-party/front_end',
      sourceDist: '/absolute/path/to/@react-native/debugger-frontend/dist',
    },
  },
  networkPanelPlugin({ patchDebuggerFrontend }),
);
```

If no `debuggerFrontend` option is provided, the core package resolves `@react-native/debugger-frontend` from the consuming app and applies the network plugin patch to that frontend.
