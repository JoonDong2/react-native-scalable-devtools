# react-native-scalable-debugger-element-inspector-plugin

[English](README.md)

`react-native-scalable-debugger`를 위한 element tree inspector plugin입니다.

이 plugin은 MCP 서버나 LLM agent 같은 도구가 앱 결과물을 확인할 수 있도록, 개발 호스트에서 현재 React Native element tree를 노출합니다.

## 사용법

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  elementInspectorPlugin,
} = require('react-native-scalable-debugger-element-inspector-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin())],
};
```

## 앱 식별자

element inspector는 snapshot 요청을 받을 연결된 React Native 런타임을 선택하기 위해 `appId`를 사용합니다. core package의 `GET /apps`로 연결된 앱을 찾은 뒤, 선택한 `appId`를 `GET /element-inspector`에 전달하세요.

`appId`를 사용하는 이유는 하나의 개발 서버에 여러 앱이 동시에 연결될 수 있기 때문입니다. 여기에는 emulator와 실제 기기가 모두 포함될 수 있습니다. 공개 REST API는 요청을 받을 AppProxy 연결을 안정적으로 선택할 selector가 필요합니다. 공개 selector는 `appId`입니다.

## `GET /apps`

`/apps` endpoint는 `react-native-scalable-debugger`가 제공합니다.

```sh
curl -s "http://localhost:8081/apps"
```

이 endpoint는 `appId`, `name`, `deviceInfo`, `connected`, `connectedAt`, `hasDebugger` 같은 연결된 app metadata를 반환합니다. element inspector 요청에는 `appId`를 사용하세요. `deviceInfo.deviceId`는 외부 자동화 도구를 위한 metadata이며 Android 또는 iOS 기기 식별자를 확인할 수 없으면 `"unknown"`입니다.

## `GET /element-inspector`

React Native 앱이 Metro에 연결된 상태에서 다음처럼 요청합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<id>"
```

지원하는 query parameter:

- `appId`: `GET /apps`에서 얻은 연결된 앱 ID.
- `compact`: `1`을 전달하면 width 또는 height가 0인 node를 제거하고, 단순 React Native wrapper pair를 flatten하며, tree node에 `type`, `layout`, `text`, `props.style`, `source`, 비어 있지 않은 `children`만 남깁니다.
- `plain`: `1`을 전달하면 JSON 대신 들여쓰기 기반 `text/plain` tree를 반환합니다.

Snapshot은 기본 JSON response를 포함한 모든 mode에서 `DebuggingOverlay`와 `LogBoxStateSubscription`이라는 React Native 개발 UI node를 생략합니다.

`GET /element-inspector`는 항상 앱 런타임에 새 스냅샷을 요청합니다. 캐시된 element tree를 반환하지 않습니다.

연결된 앱이 하나뿐이면 `appId`를 생략할 수 있습니다. 여러 앱이 연결되어 있으면 원하는 앱으로 요청이 라우팅되도록 `appId`를 전달하세요.

`compact`와 `plain`은 값이 `1`일 때만 활성화됩니다. 값이 없거나 비어 있거나 `0`이면 비활성 상태로 처리됩니다. `compact=1&plain=1`을 함께 사용하면 tree를 먼저 compact 처리한 뒤 plain text renderer가 실행됩니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<id>&compact=1"
curl -s "http://localhost:8081/element-inspector?appId=<id>&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<id>&compact=1&plain=1"
```

Plain output은 depth마다 두 칸을 들여쓰며, text, layout, style prop이 있으면 각 node를 `Type "text" [x,y,width,height] style={...}` 형식으로 렌더링합니다. `style` field는 토큰을 줄이기 위한 compact 표현이며 identifier 형태의 key에는 따옴표를 붙이지 않습니다.

```text
RCTView [0,0,390,844]
  RCTText "Welcome to React Native" [65,230,271,28] style={fontSize:18}
```

지원하지 않는 query parameter는 거부됩니다. `listDevices=1`은 지원하지 않습니다. 연결된 앱 목록은 `GET /apps`를 사용하세요.

## Debugger Frontend 커스텀

이 plugin은 debugger frontend를 patch할 필요가 없습니다. 기준 debugger frontend는 `react-native-scalable-debugger`의 `startCommand`에서 설정합니다. `react-native-scalable-debugger-network-plugin` 같은 다른 plugin은 `startCommand`가 활성 frontend에 병합할 patch 함수를 노출할 수 있습니다.

## 관련 Network Plugin

`react-native-scalable-debugger-network-plugin`을 만든 이유는 React Native 기본 디버거의 network panel이 WebSocket traffic을 독립적인 스트림으로 추적하지 않고, socket 전용 필터도 제공하지 않기 때문입니다. 같은 개발 세션에서 element snapshot과 HTTP/WebSocket inspection이 함께 필요할 때 사용하세요.
