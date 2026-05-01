# react-native-scalable-debugger

[English](README.md)

`react-native-scalable-debugger`는 이 모노레포의 코어 패키지입니다. React Native 앱에 연결되는 서버를 제공하고, 디버거 엔드포인트를 노출하며, 플러그인이 디버거 동작을 확장할 수 있는 공통 기반을 제공합니다.

## 개요

이 패키지는 디버거 스택의 시작점입니다.

이 패키지가 제공하는 것:

- 디버거 서버를 실행하는 대체 `startCommand`
- 연결된 React Native 앱을 추적하는 AppProxy
- 요청을 올바른 앱으로 보내기 위한 공용 `appId` selector
- network plugin과 element inspector plugin이 사용하는 플러그인 API
- 커스텀 HTTP endpoint, WebSocket endpoint, 디버거 프로토콜 동작을 위한 hook

하나의 앱이든 여러 앱이든, 이 패키지는 연결 모델과 플러그인 통합을 한 곳에 모아두는 계층입니다.

## 왜 필요한지

React Native 기본 디버깅 환경은 기본적인 확인에는 충분하지만, 더 제어된 워크플로우가 필요해지면 한계가 생깁니다.

이 패키지가 필요한 이유:

- 내장 React Native network panel은 socket traffic을 추적하지 못합니다.
- 기본 frontend에는 socket 전용 filter가 없습니다.
- 일부 프로젝트는 전체 스택을 fork하지 않고 debugger frontend를 커스터마이즈해야 합니다.
- element tree inspection을 통해 호스트에서 실행 중인 앱의 UI hierarchy를 직접 관찰할 수 있습니다.

목표는 core debugger를 작고, 확장 가능하고, 예측 가능하게 유지하면서 필요한 기능은 focused plugin으로 분리하는 것입니다.

## 사용법

### 디버거 서버 시작

가장 기본적인 사용법은 패키지를 설치하고 `startCommand`를 import한 뒤 플러그인을 등록하는 것입니다.

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('react-native-scalable-debugger-network-plugin');
const {
  elementInspectorPlugin,
} = require('react-native-scalable-debugger-element-inspector-plugin');
const {
  agentActionsPlugin,
} = require('react-native-agent-actions-plugin');

module.exports = {
  commands: [
    startCommand(
      networkPanelPlugin({ patchDebuggerFrontend }),
      elementInspectorPlugin(),
      agentActionsPlugin(),
    ),
  ],
};
```

### 연결된 앱 확인

서버는 `GET /apps`를 제공해서 외부 도구가 연결된 React Native 앱과 plugin endpoint에 사용할 `appId`를 찾을 수 있게 합니다.

```sh
curl -s "http://localhost:8081/apps"
```

`appId`는 debugger 요청의 public selector입니다. `deviceInfo.deviceId`는 native device identifier가 필요한 도구를 위한 metadata로 유지되며, debugger 라우팅 키는 아닙니다.

### 현재 element tree 확인

element inspector plugin은 `GET /element-inspector`를 제공합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

먼저 `GET /apps`로 연결된 앱을 확인한 뒤 선택한 `appId`를 전달하세요. 앱이 하나뿐이면 `appId`를 생략할 수 있습니다. 앱이 둘 이상이면 올바른 런타임으로 요청을 보내기 위해 `appId`가 필요합니다.

다음과 같이 사용할 수 있습니다. plugin이 React tree를 읽어 layout tree로 정리한 뒤, test agent가 결과물을 평가할 수 있습니다.

![Element inspector flow](./element-inspector.png)

element inspector plugin은 root node 선택, wrapper flatten, plain text 변환을 통해 token과 context를 절약할 수 있게 해줍니다.

가상환경이 아닌 개발 호스트 환경에서 live element tree를 직접 확인할 수 있습니다.

유용한 query parameter:

- `start`: 응답의 root로 사용할 component 이름
- `compact=1`: zero-size node를 제거하고 단순 wrapper pair를 flatten하여 노이즈를 줄임
- `plain=1`: JSON 대신 들여쓰기된 `text/plain` tree를 반환
- `layoutPrecision`: layout 값의 소수점 자릿수 제어
- `nodeId`: `1`을 전달하면 compact/plain output에 node id를 포함하고, `0`을 전달하면 JSON output에서 node id를 제거

응답은 요청 시점에 생성되므로, 현재 UI tree를 그대로 반영합니다.

### debugger frontend 커스터마이즈

base debugger frontend는 개별 plugin이 아니라 `startCommand`에서 설정합니다.

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

custom frontend를 제공하지 않으면 서버는 consuming React Native project에서 `@react-native/debugger-frontend`를 resolve하고, plugin patch를 그 frontend에 적용합니다.

## 플러그인

core package는 의도적으로 작게 유지합니다. 특별한 동작은 plugin에 두어 필요한 것만 추가할 수 있게 합니다.

### `react-native-scalable-debugger-network-plugin`

이 plugin은 React Native 기본 debugger보다 더 나은 network 가시성이 필요할 때 사용합니다.

필요한 이유:

- HTTP와 WebSocket traffic을 관찰할 수 있습니다.
- CDP `Network` domain에 기여하여 debugger에서 traffic을 확인할 수 있습니다.
- debugger frontend에 patch를 적용해 socket traffic이 network panel에서 별도 WebSocket category/filter로 보이도록 할 수 있습니다.

즉, 서버, socket, streaming API와 통신하는 앱을 디버깅할 때 쓰는 network layer입니다.

### `react-native-scalable-debugger-element-inspector-plugin`

이 plugin은 React Native element tree의 live view가 필요할 때 사용합니다.

필요한 이유:

- 실행 중인 앱에서 현재 UI hierarchy를 요청할 수 있습니다.
- 출력은 JSON 또는 plain text로 받을 수 있습니다.
- 중요한 node만 볼 수 있도록 tree를 compact 할 수 있습니다.
- 특정 component에 맞게 response root를 바꿀 수 있습니다.

이 plugin은 MCP server, test agent, custom script처럼 screenshot만으로는 부족하고 실제 app UI를 직접 검사해야 하는 워크플로우에 적합합니다.

이 이미지는 이 README 옆에 문서용으로만 두었습니다. 패키지 `files` 목록에 포함하지 않았기 때문에 npm 배포본에는 포함되지 않습니다.

### `react-native-agent-actions-plugin`

이 plugin은 외부 agent가 현재 UI target을 resolve하고, React Navigation 화면을 이동하고, 매칭된 view를 press하거나 scroll container를 스크롤해야 할 때 사용합니다.

필요한 이유:

- live element tree 관찰은 `/element-inspector`와 함께 사용합니다.
- 앱이 React Navigation `navigationRef`를 등록해서 agent가 화면을 이동할 수 있게 합니다.
- `id`, `testID`, `accessibilityLabel`, text, component 이름, broad query로 view를 찾을 수 있습니다.
- 앱 runtime에서 enabled `onPress` handler와 일반적인 scroll method를 호출할 수 있습니다.

이 plugin은 JavaScript semantic action을 수행합니다. native tap과 swipe에 가까운 fidelity가 필요하면 element snapshot을 Maestro, adb, XCTest, Appium 같은 host-side tool과 함께 사용하세요.

### 직접 plugin 만들기

`ScalableDebuggerPlugin`을 구현하면 debugger를 확장할 수 있습니다.

```typescript
import type { ScalableDebuggerPlugin } from 'react-native-scalable-debugger';

export const myCustomPlugin = (): ScalableDebuggerPlugin => ({
  name: 'my-custom-plugin',

  clientEntries: [
    { importPath: require.resolve('./client/my-plugin-client') },
  ],

  middlewareEndpoints: [
    {
      path: '/my-custom-endpoint',
      handler: (req, res, context, next) => {
        const apps = context.socketContext.listAppConnections();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apps: apps.length }));
      },
    },
  ],

  websocketEndpoints: [
    {
      path: '/my-custom-ws',
      server: (req, context) => myWebSocketServerInstance,
    },
  ],

  domains: [
    (context) => ({
      domainName: 'MyCustomDomain',
      handleDebuggerMessage: (payload) => {
        if (payload.method === 'MyCustomDomain.enable') {
          return true;
        }
      },
      handleDeviceMessage: (payload) => {},
    }),
  ],
});
```

plugin capabilities:

- `clientEntries`: React Native app이 debugger에 연결될 때 client-side code를 주입합니다.
- `middlewareEndpoints`: Metro server에 custom HTTP endpoint를 추가합니다.
- `websocketEndpoints`: Metro server에 custom WebSocket server를 추가합니다.
- `domains`: Chrome DevTools Protocol domain을 가로채거나 추가합니다.

## 기존 endpoint 요약

이 패키지는 기존 core 동작을 그대로 유지합니다.

- `GET /apps`는 연결된 앱과 metadata를 반환합니다.
- `GET /element-inspector`는 앱 runtime에서 새 tree snapshot을 요청합니다.
- `POST /agent-actions/resolve-view`, `/agent-actions/navigation/navigate`, `/agent-actions/press`, `/agent-actions/scroll`은 앱 runtime에 target resolve나 semantic action 수행을 요청합니다.
- `appId`는 외부 요청의 public selector로 유지됩니다.
- `deviceInfo.deviceId`는 device id가 필요한 도구를 위해 계속 제공됩니다.
