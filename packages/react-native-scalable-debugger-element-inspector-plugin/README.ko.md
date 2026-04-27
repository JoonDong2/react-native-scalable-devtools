# @react-native-scalable-debugger/element-inspector-plugin

[English](README.md)

`react-native-scalable-debugger`를 위한 element tree inspector plugin입니다.

이 plugin은 MCP 서버나 LLM agent 같은 도구가 앱 결과물을 확인할 수 있도록, 개발 호스트에서 현재 React Native element tree를 노출합니다.

## 사용법

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-debugger/element-inspector-plugin');

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

이 endpoint는 `appId`, `name`, `deviceInfo`, `connected`, `connectedAt`, `hasDebugger` 같은 연결된 app metadata를 반환합니다. element inspector 요청에는 `appId`를 사용하세요.

## `GET /element-inspector`

React Native 앱이 Metro에 연결된 상태에서 다음처럼 요청합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<id>"
```

지원하는 query parameter:

- `appId`: `GET /apps`에서 얻은 연결된 앱 ID.
- `timeoutMs`: 선택적 snapshot timeout.

`GET /element-inspector`는 항상 앱 런타임에 새 스냅샷을 요청합니다. 캐시된 element tree를 반환하지 않습니다.

연결된 앱이 하나뿐이면 `appId`를 생략할 수 있습니다. 여러 앱이 연결되어 있으면 원하는 앱으로 요청이 라우팅되도록 `appId`를 전달하세요.

지원하지 않는 query parameter는 거부됩니다. `listDevices=1`은 지원하지 않습니다. 연결된 앱 목록은 `GET /apps`를 사용하세요.

## Debugger Frontend 커스텀

이 plugin은 debugger frontend를 patch할 필요가 없습니다. 기준 debugger frontend는 `react-native-scalable-debugger`의 `startCommand`에서 설정합니다. `@react-native-scalable-debugger/network-plugin` 같은 다른 plugin은 `startCommand`가 활성 frontend에 병합할 patch 함수를 노출할 수 있습니다.

## 관련 Network Plugin

`@react-native-scalable-debugger/network-plugin`을 만든 이유는 React Native 기본 디버거의 network panel이 WebSocket traffic을 독립적인 스트림으로 추적하지 않고, socket 전용 필터도 제공하지 않기 때문입니다. 같은 개발 세션에서 element snapshot과 HTTP/WebSocket inspection이 함께 필요할 때 사용하세요.
