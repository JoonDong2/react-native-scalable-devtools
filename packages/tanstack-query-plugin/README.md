# @react-native-scalable-devtools/tanstack-query-plugin

[한국어](README.ko.md)

This plugin lets the React Native debugger frontend inspect a registered Tanstack Query or TanStack Query `QueryClient` in real time. It adds a `Queries` tab that shows query keys as a list, and selecting a query opens a closable detail pane with the selected query key, data, state, and error.

The plugin does not create or discover a `QueryClient` automatically. Register the app's client directly from your runtime code.

## Usage

### Register the plugin

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  patchDebuggerFrontend,
  reactQueryPlugin,
} = require('@react-native-scalable-devtools/tanstack-query-plugin');

module.exports = {
  commands: [
    startCommand(
      reactQueryPlugin({
        patchDebuggerFrontend,
      }),
    ),
  ],
};
```

Register it next to other plugins when you also need UI observation or navigation control:

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');
const {
  patchDebuggerFrontend: patchReactQueryDebuggerFrontend,
  reactQueryPlugin,
} = require('@react-native-scalable-devtools/tanstack-query-plugin');

module.exports = {
  commands: [
    startCommand(
      elementInspectorPlugin(),
      reactQueryPlugin({
        patchDebuggerFrontend: patchReactQueryDebuggerFrontend,
      }),
    ),
  ],
};
```

### Register a QueryClient

Call `registerQueryClient(queryClient)` in the app runtime after creating the QueryClient that your app passes to `QueryClientProvider`.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerQueryClient } from '@react-native-scalable-devtools/tanstack-query-plugin/client';

const queryClient = new QueryClient();

if (__DEV__) {
  registerQueryClient(queryClient);
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* app */}
    </QueryClientProvider>
  );
}
```

The plugin accepts any client with Tanstack Query-style `getQueryCache().getAll()` and `getQueryCache().subscribe(...)` methods, so it does not import `@tanstack/react-query` directly.

## Debugger Frontend

Passing `patchDebuggerFrontend` to `reactQueryPlugin` adds a `Queries` tab to the React Native debugger frontend. The tab registers a custom `ReactQuery` CDP domain and sends `ReactQuery.enable`, `ReactQuery.getQueries`, and `ReactQuery.disable` through the existing debugger socket. The devtools server routes those commands to the app already bound to that debugger session, using the same app socket mapping as the React Navigation plugin.

When the tab is enabled, the app runtime subscribes to the registered QueryClient's query cache and emits `ReactQuery.queriesUpdated` whenever query cache state changes. A short polling fallback also keeps the panel fresh if a cache implementation does not emit every update. The panel renders query keys as a list. Selecting an item opens a right-side detail pane with `queryKey`, `data`, `state`, and `error`; close the pane with the `Close` button.

## Endpoint

Use `GET /apps` from the core package first when multiple apps are connected, then pass the selected `appId`.

```sh
curl -s "http://localhost:8081/apps"
```

### Query Snapshot

```sh
curl -s "http://localhost:8081/react-query/queries?appId=<appId>"
```

The endpoint asks the app runtime for the current QueryClient cache snapshot. The result value contains `queries`, `queryCount`, and `updatedAt`. Each query includes `queryHash`, `queryKey`, `queryKeyLabel`, selected state metadata, sanitized `data`, and sanitized `error` when present.

## Notes

This plugin is for development and agent automation workflows. It observes query keys and data from the registered QueryClient; it does not mutate query data, invalidate queries, or trigger refetches.
