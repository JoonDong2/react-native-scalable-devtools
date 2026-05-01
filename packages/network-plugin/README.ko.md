# @react-native-scalable-devtools/network-plugin

[English](README.md)

`@react-native-scalable-devtools/cli`를 위한 network panel plugin입니다.

## 이 플러그인을 만든 이유

React Native 기본 디버거의 network panel은 이 디버깅 워크플로우에 충분하지 않습니다. WebSocket 트래픽을 독립적인 스트림으로 추적하지 않고, socket 전용 필터도 제공하지 않습니다. 이 플러그인은 앱 측 HTTP/WebSocket instrumentation을 추가하고, CDP `Network` domain을 통해 디버거로 네트워크 메시지를 전달합니다.

## 사용법

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-devtools/network-plugin');

module.exports = {
  commands: [
    startCommand(networkPanelPlugin({ patchDebuggerFrontend })),
  ],
};
```

## Debugger Frontend 커스텀

이 plugin은 debugger frontend를 커스텀하기 위한 `patchDebuggerFrontend`를 export합니다. 이 patch는 React Native debugger frontend에 WebSocket category/filter를 추가해서 socket traffic이 network panel에서 별도 그룹으로 보이도록 하고, Fetch/XHR traffic과 분리해서 확인할 수 있게 합니다.

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
