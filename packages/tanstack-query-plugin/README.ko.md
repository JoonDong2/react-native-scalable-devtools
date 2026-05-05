# @react-native-scalable-devtools/tanstack-query-plugin

[English](README.md)

이 plugin은 React Native debugger frontend에서 등록된 Tanstack Query 또는 TanStack Query `QueryClient`를 실시간으로 확인할 수 있게 합니다. `Queries` 탭을 추가하고 query key를 list 형태로 보여 주며, query를 선택하면 오른쪽에 선택한 query key, data, state, error를 담은 닫을 수 있는 detail pane을 엽니다.

이 plugin은 `QueryClient`를 자동으로 만들거나 찾지 않습니다. 앱 runtime code에서 사용하는 client를 직접 등록해야 합니다.

## 사용법

### plugin 등록

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

UI 관찰이나 navigation 제어도 함께 필요하다면 다른 plugin과 같이 등록하세요.

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

### QueryClient 등록

앱에서 `QueryClientProvider`에 전달하는 QueryClient를 만든 뒤 runtime code에서 `registerQueryClient(queryClient)`를 호출하세요.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerQueryClient } from '@react-native-scalable-devtools/tanstack-query-plugin/client';

if (__DEV__) {
  registerQueryClient(queryClient);
}

registerQueryClient(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* app */}
    </QueryClientProvider>
  );
}
```

이 plugin은 Tanstack Query style의 `getQueryCache().getAll()`과 `getQueryCache().subscribe(...)` method를 가진 client를 구조적으로 받으므로 `@tanstack/react-query`를 직접 import하지 않습니다.

## Debugger Frontend

`reactQueryPlugin`에 `patchDebuggerFrontend`를 전달하면 React Native debugger frontend에 `Queries` 탭이 추가됩니다. 이 탭은 커스텀 `ReactQuery` CDP domain을 등록하고, `ReactQuery.enable`, `ReactQuery.getQueries`, `ReactQuery.disable`을 기존 debugger socket으로 보냅니다. devtools server는 React Navigation plugin과 같은 app socket mapping을 사용해서 해당 debugger session에 이미 연결된 앱으로 command를 전달합니다.

탭이 활성화되면 app runtime은 등록된 QueryClient의 query cache를 구독하고 query cache state가 바뀔 때마다 `ReactQuery.queriesUpdated`를 보냅니다. Cache 구현이 모든 update를 event로 내보내지 않는 경우를 위해 짧은 polling fallback도 사용합니다. 패널은 query key를 list 형태로 렌더링합니다. 아이템을 선택하면 오른쪽 detail pane에 `queryKey`, `data`, `state`, `error`가 표시되고, `Close` button으로 닫을 수 있습니다.

## Endpoint

여러 앱이 연결되어 있으면 core package의 `GET /apps`를 먼저 호출하고 선택한 `appId`를 전달하세요.

```sh
curl -s "http://localhost:8081/apps"
```

### Query Snapshot

```sh
curl -s "http://localhost:8081/react-query/queries?appId=<appId>"
```

이 endpoint는 app runtime에 현재 QueryClient cache snapshot을 요청합니다. Result value에는 `queries`, `queryCount`, `updatedAt`이 포함됩니다. 각 query에는 `queryHash`, `queryKey`, `queryKeyLabel`, 선별된 state metadata, sanitize된 `data`, 그리고 error가 있으면 sanitize된 `error`가 포함됩니다.

## Notes

이 plugin은 development와 agent automation workflow를 위한 기능입니다. 등록된 QueryClient에서 query key와 data를 관찰합니다. Query data를 변경하거나, query를 invalidate하거나, refetch를 실행하지는 않습니다.
