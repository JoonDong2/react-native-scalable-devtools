# react-native-scalable-devtools

[English](README.md)

`@react-native-scalable-devtools/cli`는 이 모노레포의 코어 패키지입니다. React Native 앱에 연결되는 서버를 제공하고, 디버거 엔드포인트를 노출하며, 플러그인이 디버거 동작을 확장할 수 있는 공통 기반을 제공합니다.

이 프로젝트는 작은 core package와 목적이 분명한 plugin으로 나뉘어 있어서, 필요한 기능만 골라서 사용할 수 있습니다.

## 개요

이 저장소는 기본 React Native 디버깅 환경보다 확장하기 쉬운 debugger stack을 제공합니다.

구성 요소는 다음과 같습니다:

- React Native 앱에 연결되는 core debugger server
- 올바른 앱으로 요청을 보내기 위한 공용 `appId` selector
- HTTP endpoint, WebSocket endpoint, debugger hook을 추가하는 plugin system
- network inspection과 live element-tree inspection을 위한 focused plugin

한 줄로 말하면, core package가 서버를 시작하고 plugin이 그 위에 필요한 디버깅 기능을 얹습니다.

## 왜 필요한지

React Native 기본 디버깅 도구는 기본적인 작업에는 유용하지만, 더 제어된 워크플로우가 필요해지면 한계가 생깁니다.

이 모노레포가 필요한 이유:

- 기본 network panel만으로는 socket traffic을 충분히 보기 어렵습니다.
- 개발 호스트에서 현재 UI hierarchy를 직접 확인하고 싶을 수 있습니다.
- debugger frontend를 전체 fork 없이 커스터마이즈하고 싶을 수 있습니다.
- 서로 다른 디버깅 요구를 하나의 큰 패키지보다 plugin으로 나누는 편이 유지보수에 유리합니다.

목표는 core debugger를 작고 예측 가능하게 유지하면서, plugin이 필요한 기능만 추가하도록 하는 것입니다.

## 사용법

core package를 시작점으로 두고 필요한 plugin만 등록하면 됩니다.

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-devtools/network-plugin');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');
const {
  agentActionsPlugin,
} = require('@react-native-scalable-devtools/agent-actions-plugin');

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

유용한 endpoint:

- `@react-native-scalable-devtools/cli`의 `GET /apps`: 연결된 앱, `appId`, 그리고 각 앱에 대해 호스트 OS가 인식한 디바이스 식별자를 확인합니다.
- `@react-native-scalable-devtools/element-inspector-plugin`의 `GET /element-inspector`: 연결된 앱의 live element tree를 가져옵니다.
- `@react-native-scalable-devtools/agent-actions-plugin`의 `POST /agent-actions/*`: 외부 agent가 연결된 앱의 target을 resolve하고 navigate, press, scroll 할 수 있게 합니다.

앱이 하나뿐이면 `appId`를 생략할 수 있는 경우가 많습니다. 앱이 둘 이상이면 요청이 원하는 runtime으로 가도록 `appId`를 전달해야 합니다.

`GET /apps`의 `deviceInfo.deviceId`는 Maestro CLI 같은 도구로 특정 디바이스를 조작할 때 유용합니다. 그런 다음 [element inspector plugin](packages/element-inspector-plugin/README.ko.md)으로 그 상태의 layout tree snapshot을 얻을 수 있습니다.

## 패키지

- `@react-native-scalable-devtools/cli`: core debugger server입니다. `startCommand`, 연결된 앱을 추적하는 AppProxy, 커스텀 endpoint와 debugger hook을 위한 plugin API를 제공합니다. [패키지 README](packages/cli/README.md) 참고.
- `@react-native-scalable-devtools/network-plugin`: network inspection plugin입니다. 기본 React Native network panel보다 더 나은 HTTP 요청과 WebSocket 트래픽 가시성이 필요할 때 사용합니다. socket traffic을 Fetch/XHR와 분리해서 볼 수 있도록 debugger frontend도 patch합니다. [패키지 README](packages/network-plugin/README.md) 참고.
- `@react-native-scalable-devtools/element-inspector-plugin`: live element-tree inspection plugin입니다. 개발 호스트에서 현재 React Native UI hierarchy를 확인하고, tree를 compact 하거나, agent나 script가 읽기 쉬운 plain text로 바꾸고, Maestro CLI 같은 호스트 도구로 앱을 특정 상태로 만든 뒤 snapshot을 얻고 싶을 때 사용합니다. [패키지 README](packages/element-inspector-plugin/README.ko.md) 참고.
- `@react-native-scalable-devtools/agent-actions-plugin`: agent action plugin입니다. 외부 LLM agent가 현재 UI target을 resolve하고, 등록된 `navigationRef`로 React Navigation 화면을 이동하고, 매칭된 view를 press하거나 scroll container를 스크롤해야 할 때 사용합니다. [패키지 README](packages/agent-actions-plugin/README.ko.md) 참고.

## 패키지 문서

각 package는 더 자세한 README를 따로 제공합니다.

- [core package README](packages/cli/README.md)
- [network plugin README](packages/network-plugin/README.md)
- [element inspector plugin README](packages/element-inspector-plugin/README.md)
- [agent actions plugin README](packages/agent-actions-plugin/README.ko.md)
