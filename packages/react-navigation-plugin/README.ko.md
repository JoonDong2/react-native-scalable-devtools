# @react-native-scalable-devtools/react-navigation-plugin

[English](README.md)

이 plugin은 외부 agent가 실행 중인 React Native 앱에서 등록된 React Navigation state를 읽고, route로 navigate 하거나 go back 할 수 있도록 host-side endpoint를 제공합니다. 또한 React Native debugger frontend를 patch해서 등록된 navigation state를 실시간으로 보여 주는 Navigation 탭을 추가할 수 있습니다.

이 plugin은 React Navigation ref 등록을 담당합니다. UI tree를 관찰하거나 view action을 실행하지는 않습니다. 관찰에는 `@react-native-scalable-devtools/element-inspector-plugin`을, press와 scroll에는 `@react-native-scalable-devtools/agent-actions-plugin`을 사용하세요.

## 사용법

### plugin 등록

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

agent workflow에서 화면 이동과 UI action이 모두 필요하면 다른 plugin과 함께 등록할 수 있습니다.

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

### React Navigation ref 등록

plugin이 navigation container를 자동으로 찾지는 않습니다. 앱에서 navigation ref를 만들고 client entry에 등록해야 합니다.

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

이 plugin은 필요한 React Navigation style method를 가진 ref를 구조적으로 받기 때문에 `@react-navigation/native`를 직접 import하지 않습니다.

## Debugger frontend 탭

`reactNavigationPlugin`에 `patchDebuggerFrontend`를 전달하면 React Native debugger frontend에 `Navigation` 탭이 추가됩니다. 이 탭은 커스텀 `ReactNavigation` CDP domain을 등록하고, `ReactNavigation.enable`, `ReactNavigation.getState`, `ReactNavigation.disable`을 기존 debugger socket으로 보냅니다. devtools server는 network plugin과 같은 app socket mapping을 사용해서 해당 debugger session에 이미 연결된 앱으로 command를 전달합니다.

탭이 활성화되면 app runtime은 등록된 navigation ref를 구독하고 navigation state가 바뀔 때마다 `ReactNavigation.stateUpdated`를 보냅니다. 패널은 root history를 route list로 렌더링하고 stack 같은 nested navigator의 routes를 펼쳐 보여 주며, route를 선택하면 `name`, `key`, `params`를 담은 닫을 수 있는 상세 패널을 엽니다. Event에는 `updatedAt`, 그리고 `isReady`, sanitize된 root `state`, `currentRoute`를 담은 state snapshot이 포함됩니다. `state` listener를 노출하지 않는 navigation ref를 위해 짧은 polling fallback도 사용합니다.

## Endpoints

여러 앱이 연결되어 있으면 core package의 `GET /apps`를 먼저 호출하고 선택한 `appId`를 전달하세요.

```sh
curl -s "http://localhost:8081/apps"
```

### Navigate

```sh
curl -s -X POST "http://localhost:8081/react-navigation/navigate" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","name":"Settings","params":{"tab":"profile"}}'
```

runtime에서 등록된 `navigationRef.navigate(...)`를 호출합니다. Request body는 `name`, `params`, `key`, `path`, `merge`를 top-level로 전달하거나 `navigation` object 안에 넣을 수 있습니다.

### Go back

```sh
curl -s -X POST "http://localhost:8081/react-navigation/back" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>"}'
```

등록된 ref가 `canGoBack()`을 노출하면 `goBack()`을 호출하기 전에 확인합니다.

### Navigation state

```sh
curl -s "http://localhost:8081/react-navigation/state?appId=<appId>"
```

이 endpoint는 앱 runtime에서 등록된 React Navigation ref를 읽고, `value` 안에 `isReady`, sanitize된 root navigation `state`, `currentRoute`를 담은 result를 반환합니다. 별도의 화면 요약 field를 만들지 않으므로 agent는 `result.value.state` 안의 React Navigation 고유 `index`와 `routes` 구조를 읽어서 판단하면 됩니다.

응답 예시:

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

이 plugin은 development와 agent automation workflow를 위한 기능입니다. 등록된 React Navigation ref를 통해 semantic JavaScript navigation을 수행합니다. Native tap, gesture, OS-level back 동작을 시뮬레이션하지는 않습니다.

agent가 매칭된 React Native view를 press하거나 container를 scroll해야 한다면 `@react-native-scalable-devtools/agent-actions-plugin`을 사용하세요.
