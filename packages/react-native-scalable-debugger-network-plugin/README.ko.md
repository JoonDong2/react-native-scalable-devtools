# @react-native-scalable-debugger/network-plugin

[English](README.md)

`react-native-scalable-debugger`를 위한 network panel plugin입니다.

## 이 플러그인을 만든 이유

React Native 기본 디버거의 network panel은 이 디버깅 워크플로우에 충분하지 않습니다. WebSocket 트래픽을 독립적인 스트림으로 추적하지 않고, socket 전용 필터도 제공하지 않습니다. 이 플러그인은 앱 측 HTTP/WebSocket instrumentation을 추가하고, CDP `Network` domain을 통해 디버거로 네트워크 메시지를 전달합니다.

## 사용법

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

## Debugger Frontend 커스텀

이 plugin은 debugger frontend를 커스텀하기 위한 `patchDebuggerFrontend`를 export합니다. 이 patch는 React Native debugger frontend에 WebSocket category/filter를 추가하여 socket traffic을 Fetch/XHR traffic과 분리해서 볼 수 있게 합니다.

기준 debugger frontend는 여전히 `startCommand`에서 설정합니다. plugin은 patch 함수를 제공하고, 어떤 frontend를 기준으로 사용할지는 `startCommand`가 결정합니다.

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

`debuggerFrontend` option을 제공하지 않으면 core package가 consuming app에서 `@react-native/debugger-frontend`를 resolve하고, network plugin patch를 그 frontend에 적용합니다.

## 앱 식별자

network plugin 자체는 REST endpoint를 노출하지 않지만, core AppProxy 연결 모델 위에서 동작합니다. core package는 외부 도구가 연결된 앱 런타임을 일관되게 식별할 수 있도록 `GET /apps`를 통해 `appId`를 노출합니다.

외부 도구가 core 또는 다른 plugin endpoint를 통해 연결된 앱을 대상으로 요청해야 한다면 `appId`를 사용하세요.

## 관련 Endpoint

`GET /apps`는 `react-native-scalable-debugger`가 제공합니다.

```sh
curl -s "http://localhost:8081/apps"
```

이 endpoint는 연결된 app metadata와 공개 selector인 `appId`를 반환합니다.

`GET /element-inspector`는 `@react-native-scalable-debugger/element-inspector-plugin`이 제공합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

network plugin은 element inspector plugin 없이도 사용할 수 있지만, 두 plugin은 동일한 core AppProxy 모델을 사용합니다.
