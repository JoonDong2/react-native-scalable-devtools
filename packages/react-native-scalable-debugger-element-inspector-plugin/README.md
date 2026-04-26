# @react-native-scalable-debugger/element-inspector-plugin

[한국어](README.ko.md)

Element tree inspector plugin for `react-native-scalable-debugger`.

The plugin exposes the current React Native element tree through the development host so tools such as MCP servers and LLM agents can inspect the app output.

## Usage

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-debugger/element-inspector-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin())],
};
```

## App Identity

The element inspector uses `appId` to select the connected React Native runtime that should receive the snapshot request. Use `GET /apps` from the core package to discover connected apps, then pass the selected `appId` to `GET /element-inspector`.

`appId` is used because a development server can have multiple connected apps at the same time, including emulators and physical devices. The public REST API needs a stable selector for the AppProxy connection that will receive the request. The public selector is `appId`.

## `GET /apps`

The `/apps` endpoint is provided by `react-native-scalable-debugger`:

```sh
curl -s "http://localhost:8081/apps"
```

It returns connected app metadata such as `appId`, `nativeAppId`, `name`, `deviceInfo`, `connected`, `connectedAt`, and `hasDebugger`. Use `appId` for element inspector requests.

## `GET /element-inspector`

When the React Native app is connected to Metro:

```sh
curl -s "http://localhost:8081/element-inspector?appId=<id>"
```

Supported query parameters:

- `appId`: connected app id from `GET /apps`.
- `timeoutMs`: optional snapshot timeout.

`GET /element-inspector` always asks the app runtime for a fresh snapshot. It does not return a cached element tree.

If only one app is connected, `appId` may be omitted. If multiple apps are connected, pass `appId` so the request is routed to the intended app.

Unsupported query parameters are rejected. `listDevices=1` is not supported; use `GET /apps` instead.

## Debugger Frontend Customization

This plugin does not need to patch the debugger frontend. The base debugger frontend is configured by `startCommand` in `react-native-scalable-debugger`. Other plugins, such as `@react-native-scalable-debugger/network-plugin`, can expose patch functions that `startCommand` merges into the active frontend.

## Related Network Plugin

`@react-native-scalable-debugger/network-plugin` exists because the built-in React Native debugger network panel does not track WebSocket traffic as a first-class stream and does not include a socket-specific filter. Use it when the same development session needs HTTP/WebSocket inspection alongside element snapshots.
