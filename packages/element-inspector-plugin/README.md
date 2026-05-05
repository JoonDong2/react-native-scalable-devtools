# @react-native-scalable-devtools/element-inspector-plugin

[한국어](README.ko.md)


This plugin exposes the current UI hierarchy of a connected React Native app, including the actual layout rendered on a device or simulator, so tools such as MCP servers, scripts, and agents can inspect the app output directly from the development host.

## Usage

### Register the plugin

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin())],
};
```

### Discover connected apps

The plugin uses the `appId` exposed by `GET /apps` in the core package.

```sh
curl -s "http://localhost:8081/apps"
```

Use the returned `appId` when requesting the element tree. If only one app is connected, `appId` can be omitted. If multiple apps are connected, pass `appId` so the request reaches the right runtime.

### Request the current element tree

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

The endpoint always asks the app runtime for a fresh snapshot. It does not return a cached tree.

Supported query parameters:

- `appId`: connected app id from `GET /apps`
- `start`: choose a component name as the response root
- `compact`: pass `1` to remove zero-size nodes, flatten simple wrapper pairs, and trim the response to the most useful fields
- `plain`: pass `1` to return an indented `text/plain` tree instead of JSON
- `layoutPrecision`: number of decimal places to keep in `layout` values
- `nodeId`: controls node id output. Pass `1` to include node ids, or `0` to remove them from JSON output. When omitted, the default JSON response keeps node ids, and compact/plain output omits them.

The only supported compact mode is `compact=1`. Empty values, missing values, and `0` leave the mode disabled.

When `compact` and `plain=1` are used together, the tree is compacted first and then rendered as plain text.
When `plain=1` is enabled, `displayName` replaces the node label when it is available.

Examples:

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&start=RCTView"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&layoutPrecision=2"
```

## Element Inspector Flow

You can use it like this: the plugin reads the React tree, turns it into a layout tree, and returns a result that a test agent can evaluate directly.

![Element inspector flow](../cli/element-inspector.png)

The element inspector plugin helps reduce token and context usage by letting you select a root node, flatten wrapper nodes, or convert the tree into plain text before handing it to an agent.

From the host, you can inspect the live element tree without attaching a visual debugger or taking a screenshot first.

Plain output uses two spaces per depth and renders each node as `Type "text" [x,y,width,height] style={...}` when text, layout, and style props are available. When target props such as `testID`, `nativeID`, or `accessibilityLabel` are present, they are rendered as `props={...}`. When `nodeId=1` is enabled, the node id is rendered as `id=<id>`. The `style` field uses a compact representation that omits quotes around identifier-like keys. `layout` values use the same decimal precision as the JSON response and default to one decimal place.

```text
RCTView id=root.0 [0,0,390,844]
  RCTText id=root.0.1 "Welcome to React Native" [65,230,271,28] style={fontSize:18}
```

## Output Notes

Snapshots omit React Native development UI nodes named `DebuggingOverlay` and `LogBoxStateSubscription` in all modes, including the default JSON response.

JSON responses include `displayName` on element nodes. When a component does not define `displayName`, the field falls back to the node `type`.

Compact JSON and plain text responses keep node ids when `nodeId=1` is passed, so another tool can act on a node after reading a compacted tree. When wrapper nodes are collapsed, the remaining child keeps its own original `id`.

## App Identity

The plugin uses `appId` to select the connected React Native runtime that should receive the snapshot request.

Use `GET /apps` from the core package to discover connected apps and check the app list at `/apps`, then pass the selected `appId` to `GET /element-inspector`.

`appId` is used because a development server can have multiple connected apps at the same time, including emulators and physical devices. The public REST API needs a stable selector for the AppProxy connection that will receive the request.

`deviceInfo.deviceId` is still available from `GET /apps` as metadata for external automation tools. It is `"unknown"` when no Android or iOS device identifier can be resolved.
`deviceInfo.deviceId` can be useful if you want to target a specific device with tools such as Maestro CLI, then capture a layout tree snapshot for that exact app state with `GET /element-inspector`.

## Package Notes

This plugin does not patch the debugger frontend.

It can be used independently of the network plugin, but both plugins share the same core AppProxy model from `@react-native-scalable-devtools/cli`.
