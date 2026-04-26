# react-native-scalable-debugger

[English](README.md)

플러그인 지향 React Native 디버거 서버입니다. 대체 `start` command, 연결된 앱 런타임을 관리하는 AppProxy, 플러그인 HTTP/WebSocket endpoint, 앱 측 클라이언트 부트스트랩 주입, debugger-frontend 커스텀 hook을 제공합니다.

## 패키지

- `react-native-scalable-debugger`: 코어 서버, AppProxy, 플러그인 API, `startCommand`.
- `@react-native-scalable-debugger/network-plugin`: HTTP와 WebSocket 트래픽을 위한 네트워크 패널 지원.
- `@react-native-scalable-debugger/element-inspector-plugin`: 연결된 React Native 앱의 엘리먼트 트리 스냅샷을 REST/WebSocket으로 제공.

## 사용법

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-debugger/network-plugin');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-debugger/element-inspector-plugin');

module.exports = {
  commands: [
    startCommand(
      networkPanelPlugin({ patchDebuggerFrontend }),
      elementInspectorPlugin(),
    ),
  ],
};
```

## 앱 식별자

코어 서버는 연결된 각 React Native 런타임에 대해 `appId`를 노출합니다. 외부 도구가 앱을 선택할 때는 이 `appId`를 사용해야 합니다.

`appId`를 노출하는 이유는 하나의 디버거 서버에 여러 앱이 동시에 연결될 수 있기 때문입니다. 여기에는 여러 emulator나 실제 기기가 포함될 수 있습니다. REST endpoint는 요청을 받을 AppProxy 연결을 안정적으로 선택할 공개 selector가 필요합니다. 서버는 호환성과 진단을 위해 내부 device metadata를 유지하지만, 공개 API는 `appId`로 선택합니다.

## `GET /apps`

코어 AppProxy는 다음 endpoint를 제공합니다.

```sh
curl -s "http://localhost:8081/apps"
```

이 endpoint는 연결된 React Native 앱 목록과 plugin endpoint에서 사용할 `appId`를 반환합니다.

응답 예시:

```json
{
  "ok": true,
  "apps": [
    {
      "appId": "skw4tbpgjn",
      "nativeAppId": "com.example.myapp",
      "name": "Pixel 8",
      "deviceInfo": {
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

모든 외부 요청의 selector는 `appId`입니다.

## `GET /element-inspector`

element inspector plugin은 다음 endpoint를 제공합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

먼저 `GET /apps`로 연결된 앱을 확인한 뒤 선택한 `appId`를 전달합니다. 연결된 앱이 하나뿐이면 `appId`를 생략할 수 있습니다. 여러 앱이 연결되어 있으면 올바른 런타임으로 요청을 라우팅하기 위해 `appId`가 필요합니다.

지원하는 query parameter:

- `appId`: `GET /apps`에서 얻은 연결된 앱 ID.
- `timeoutMs`: 선택적 snapshot timeout.

지원하지 않는 query parameter는 거부됩니다. `listDevices=1`은 지원하지 않습니다. 연결된 앱 목록은 `GET /apps`를 사용하세요.

`GET /element-inspector`는 요청 시점에 앱 런타임에 새 스냅샷을 요청합니다. 캐시된 엘리먼트 트리를 반환하지 않습니다. 이 플러그인은 MCP 서버나 LLM agent가 개발 호스트에서 현재 React Native 결과물을 확인하기 위한 용도입니다.

## Network Plugin

network plugin을 만든 이유는 React Native 기본 디버거의 network panel이 이 워크플로우에 필요한 socket 가시성을 충분히 제공하지 않기 때문입니다. WebSocket 트래픽이 독립적인 스트림으로 추적되지 않고, 기본 frontend에는 socket 전용 필터가 없습니다.

`@react-native-scalable-debugger/network-plugin`은 앱 측 HTTP/WebSocket instrumentation을 추가하고, 디버거가 트래픽을 확인할 수 있도록 CDP `Network` domain에 기여합니다. 또한 `patchDebuggerFrontend`를 export하며, `startCommand`와 함께 사용할 때 debugger frontend에 WebSocket category/filter를 추가합니다.

## Debugger Frontend 커스텀

기준 debugger frontend는 개별 plugin이 아니라 `startCommand`에서 설정합니다. Plugin은 start command option에 병합될 patch 함수를 노출할 수 있습니다.

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('@react-native-scalable-debugger/network-plugin');

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

custom base frontend를 제공하지 않으면 서버는 consuming React Native project에서 `@react-native/debugger-frontend`를 resolve하고, plugin patch를 그 frontend에 적용합니다.
