# react-native-scalable-debugger

[한국어](README.ko.md)

Monorepo for a plugin-oriented React Native debugger server. It provides a replacement `start` command, an AppProxy for connected app runtimes, plugin HTTP/WebSocket endpoints, app-side client bootstrap injection, and debugger-frontend customization hooks.

## Packages

- `react-native-scalable-debugger`: core server, client bootstrap, and plugin API.
- `react-native-scalable-debugger-network-plugin`: Network panel support for HTTP and WebSocket traffic.
- `react-native-scalable-debugger-element-inspector-plugin`: REST/WebSocket element tree snapshots for connected React Native apps.

## Publishing

Packages are published by GitHub Actions on pushes to `main`. The workflow publishes only packages with changes under their package directory. See [Publishing](docs/publishing.md) for the versioning and release rules.

## Usage

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('react-native-scalable-debugger-network-plugin');
const {
  elementInspectorPlugin,
} = require('react-native-scalable-debugger-element-inspector-plugin');

module.exports = {
  commands: [
    startCommand(
      networkPanelPlugin({ patchDebuggerFrontend }),
      elementInspectorPlugin(),
    ),
  ],
};
```

## App Identity

The core server exposes an `appId` for each connected React Native runtime. External tools should use this `appId` when selecting an app.

`appId` is exposed because the debugger server can have more than one connected app at the same time, including multiple emulators or physical devices. The REST endpoints need a stable public selector that points to the AppProxy connection that will receive a request. The server still keeps internal device metadata for compatibility and diagnostics, but public APIs select by `appId`.

## `GET /apps`

The core AppProxy provides:

```sh
curl -s "http://localhost:8081/apps"
```

This returns the connected React Native apps, the `appId` values to use with plugin endpoints, and device metadata such as `deviceInfo.deviceId`.

Example shape:

```json
{
  "ok": true,
  "apps": [
    {
      "appId": "skw4tbpgjn",
      "name": "Pixel 8",
      "deviceInfo": {
        "deviceId": "emulator-5554",
        "platform": "android",
        "os": "android",
        "deviceName": "Pixel 8",
        "isEmulator": true,
        "reactNativeVersion": "0.85.2"
      },
      "connected": true,
      "connectedAt": 1777219200000,
      "hasDebugger": true
    }
  ]
}
```

`appId` is the selector for all external requests. `deviceInfo.deviceId` is metadata for external automation tools such as Maestro.

Device identifiers are resolved in this order:

1. The app runtime reports `deviceInfo.deviceId` from React Native `Platform.constants` when a native identifier is available.
2. If the runtime does not provide an identifier, the server enriches `/apps` from host-side tools. Android uses `adb devices -l`; iOS uses `xcrun simctl list --json devices booted` for simulators and `xcrun devicectl list devices --json-output -` or `xcrun xctrace list devices` for physical devices.
3. Host devices are matched to the connected app by comparable runtime metadata such as device name, model, and OS version. If there is only one host device for the app platform, that device id is used as the fallback match.

When no Android or iOS device identifier can be resolved, `deviceInfo.deviceId` is set to `"unknown"`.

## `GET /element-inspector`

The element inspector plugin provides:

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

Use `GET /apps` first, then pass the selected `appId`. If only one app is connected, `appId` may be omitted. If multiple apps are connected, the endpoint requires `appId` so it can route the request to the correct runtime.

Supported query parameters:

- `appId`: connected app id from `GET /apps`.
- `timeoutMs`: optional snapshot timeout.
- `compact`: pass `1` to remove zero-size nodes and `DebuggingOverlay`, flatten simple React Native wrapper pairs, and keep only `type`, `layout`, `text`, `props.style`, `source`, and non-empty `children` on tree nodes.
- `plain`: pass `1` to return an indented `text/plain` tree instead of JSON.

Unsupported query parameters are rejected. `listDevices=1` is not supported; use `GET /apps` instead.

Only the value `1` enables `compact` and `plain`; missing values, empty values, and `0` leave the mode disabled. When `compact=1&plain=1` are used together, compaction runs first and the plain response contains only the rendered tree.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1&plain=1"
```

Plain output renders one node per line, with two spaces per depth and layouts formatted as `[x,y,width,height]`.

`GET /element-inspector` asks the app runtime for a fresh snapshot when the request is made. It does not serve a cached element tree. The plugin is intended for tools such as MCP servers and LLM agents that need to inspect the current React Native output from the development host.

## Network Plugin

The network plugin exists because the built-in React Native debugger network panel does not provide enough socket visibility for this workflow: WebSocket traffic is not tracked as a first-class stream and there is no socket-specific filter in the stock frontend.

`react-native-scalable-debugger-network-plugin` adds app-side HTTP and WebSocket instrumentation and contributes to the CDP `Network` domain so the debugger can inspect the traffic. It also exports `patchDebuggerFrontend`, which adds a WebSocket category/filter to the debugger frontend when used with `startCommand`.

## Debugger Frontend Customization

The base debugger frontend is configured on `startCommand`, not on an individual plugin. Plugins may expose patch functions that are merged into the start command options.

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('react-native-scalable-debugger-network-plugin');

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

If no custom base frontend is provided, the server resolves `@react-native/debugger-frontend` from the consuming React Native project and applies any plugin patches to that frontend.

## Creating a Plugin

The debugger server can be extended using plugins that implement the `ScalableDebuggerPlugin` interface. A plugin can inject code into the client app, expose HTTP and WebSocket endpoints, and intercept Chrome DevTools Protocol (CDP) messages.

```typescript
import type { ScalableDebuggerPlugin } from 'react-native-scalable-debugger';

export const myCustomPlugin = (): ScalableDebuggerPlugin => ({
  name: 'my-custom-plugin',
  
  // 1. Inject client-side code into the React Native app
  clientEntries: [
    { importPath: require.resolve('./client/my-plugin-client') }
  ],
  
  // 2. Add custom HTTP REST endpoints
  middlewareEndpoints: [
    {
      path: '/my-custom-endpoint',
      handler: (req, res, context, next) => {
        const apps = context.socketContext.listAppConnections();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apps: apps.length }));
      }
    }
  ],
  
  // 3. Add custom WebSocket endpoints
  websocketEndpoints: [
    {
      path: '/my-custom-ws',
      server: (req, context) => {
        // Return a ws.WebSocketServer instance
        return myWebSocketServerInstance;
      }
    }
  ],
  
  // 4. Intercept or add CDP (Chrome DevTools Protocol) Domains
  domains: [
    (context) => ({
      domainName: 'MyCustomDomain',
      handleDebuggerMessage: (payload) => {
        // Handle messages from the debugger frontend
        if (payload.method === 'MyCustomDomain.enable') {
          return true; // Return true to stop propagation
        }
      },
      handleDeviceMessage: (payload) => {
        // Handle messages from the device
      }
    })
  ]
});
```

### Plugin Features

- **`clientEntries`**: Absolute paths to modules that will be automatically imported into the React Native app when it connects to the debugger. This is useful for injecting instrumentation or interceptors.
- **`middlewareEndpoints`**: Custom REST API endpoints mounted on the Metro server. Use the `context.socketContext` to interact with connected apps.
- **`websocketEndpoints`**: Custom WebSocket servers mounted on the Metro server at specific paths.
- **`domains`**: Custom handlers for CDP domains. You can use this to add new domains or intercept messages for existing domains (e.g., `Network`, `Debugger`, `Runtime`) between the React Native app and the debugger frontend.

## Development

```sh
yarn install
yarn build
yarn typecheck
```
