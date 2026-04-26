# @react-native-scalable-debugger/network-plugin

[한국어](README.ko.md)

Network panel plugin for `react-native-scalable-debugger`.

## Why This Plugin Exists

The built-in React Native debugger network panel is not enough for this debugging workflow because it does not track WebSocket traffic as a first-class stream and it does not provide a socket-specific filter. This plugin adds app-side HTTP and WebSocket instrumentation and contributes network messages to the debugger through the CDP `Network` domain.

## Usage

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-debugger/network-plugin');

module.exports = {
  commands: [
    startCommand(networkPanelPlugin({ patchDebuggerFrontend })),
  ],
};
```

## Debugger Frontend Customization

The plugin exports `patchDebuggerFrontend` to customize the debugger frontend. The patch adds a WebSocket category/filter to the React Native debugger frontend so socket traffic can be separated from Fetch/XHR traffic.

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

## App Identity

The network plugin does not expose a REST endpoint, but it runs on top of the core AppProxy connection model. The core package exposes `appId` values through `GET /apps` so external tools can identify connected app runtimes consistently.

Use `appId` when an external tool needs to target a connected app through core or other plugin endpoints.

## Related Endpoints

`GET /apps` is provided by `react-native-scalable-debugger`:

```sh
curl -s "http://localhost:8081/apps"
```

It returns connected app metadata and the public `appId` selector.

`GET /element-inspector` is provided by `@react-native-scalable-debugger/element-inspector-plugin`:

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

The network plugin can be used independently of the element inspector plugin, but both plugins use the same core AppProxy model.
