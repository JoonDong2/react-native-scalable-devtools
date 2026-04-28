# react-native-scalable-debugger

[English](README.md)

플러그인 지향 React Native 디버거 서버를 위한 모노레포입니다. 대체 `start` command, 연결된 앱 런타임을 관리하는 AppProxy, 플러그인 HTTP/WebSocket endpoint, 앱 측 클라이언트 부트스트랩 주입, debugger-frontend 커스텀 hook을 제공합니다.

## 패키지

- `react-native-scalable-debugger`: 코어 서버, 클라이언트 부트스트랩, 플러그인 API.
- `react-native-scalable-debugger-network-plugin`: HTTP와 WebSocket 트래픽을 위한 네트워크 패널 지원.
- `react-native-scalable-debugger-element-inspector-plugin`: 연결된 React Native 앱의 엘리먼트 트리 스냅샷을 REST/WebSocket으로 제공.

## 배포

Package는 `main` branch push 시 GitHub Actions에서 npm으로 배포됩니다. Workflow는 각 package directory 아래에 변경이 있는 package만 배포합니다. Versioning과 release rule은 [Publishing](docs/publishing.ko.md)을 참고하세요.

## 사용법

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  networkPanelPlugin,
  patchDebuggerFrontend,
} = require('react-native-scalable-debugger-network-plugin');
const {
  elementInspectorPlugin,
} = require('react-native-scalable-debugger-element-inspector-plugin');

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

이 endpoint는 연결된 React Native 앱 목록, plugin endpoint에서 사용할 `appId`, 그리고 확인 가능한 경우 `deviceInfo.deviceId` 같은 기기 metadata를 반환합니다.

응답 예시:

```json
{
  "ok": true,
  "apps": [
    {
      "appId": "skw4tbpgjn",
      "name": "Pixel 8",
      "deviceInfo": {
        "deviceId": "emulator-5554",
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

모든 외부 요청의 selector는 `appId`입니다. `deviceInfo.deviceId`는 Maestro 같은 외부 자동화 도구를 위한 metadata입니다. 서버는 앱 런타임이 보낸 값이 있으면 그 값을 사용하고, 없으면 `adb devices -l`, `xcrun simctl`, `xcrun devicectl`, `xcrun xctrace` 같은 host 도구로 보강합니다. Android 또는 iOS 기기 식별자를 확인할 수 없으면 `deviceInfo.deviceId`는 `"unknown"`으로 설정됩니다.

## `GET /element-inspector`

element inspector plugin은 다음 endpoint를 제공합니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>"
```

먼저 `GET /apps`로 연결된 앱을 확인한 뒤 선택한 `appId`를 전달합니다. 연결된 앱이 하나뿐이면 `appId`를 생략할 수 있습니다. 여러 앱이 연결되어 있으면 올바른 런타임으로 요청을 라우팅하기 위해 `appId`가 필요합니다.

지원하는 query parameter:

- `appId`: `GET /apps`에서 얻은 연결된 앱 ID.
- `start`: response root로 사용할 선택적 component name. Component가 `displayName`을 정의하면 그 값과 비교하고, 없으면 `type`과 비교합니다. tree를 root부터 DFS로 탐색하되 children은 오른쪽부터 방문하며, 처음 일치하는 node를 반환 root로 사용합니다. 일치하는 node가 없으면 빈 tree를 반환합니다.
- `compact`: `1`을 전달하면 width 또는 height가 0인 node를 제거하고, 단순 React Native wrapper pair를 flatten하며, top-level `props.style` 배열을 하나의 객체로 flatten하고, tree node에 `type`, `displayName`, `layout`, `text`, `props.style`, `source`, 비어 있지 않은 `children`만 남깁니다.
- `plain`: `1`을 전달하면 JSON 대신 들여쓰기 기반 `text/plain` tree를 반환합니다. Plain text node label은 `displayName`이 있으면 그 값을 사용하고, 없으면 `type`을 사용합니다.
- `layoutPrecision`: `layout` 값에 남길 소수점 자릿수입니다. 기본값은 `1`입니다.

Snapshot은 기본 JSON response를 포함한 모든 mode에서 `DebuggingOverlay`와 `LogBoxStateSubscription`이라는 React Native 개발 UI node를 생략합니다.

JSON response는 element node에 `displayName`을 포함합니다. Component가 `displayName`을 정의하지 않으면 이 field는 node `type`으로 fallback됩니다.

지원하지 않는 query parameter는 거부됩니다. `listDevices=1`은 지원하지 않습니다. 연결된 앱 목록은 `GET /apps`를 사용하세요.

`compact`와 `plain`은 값이 `1`일 때만 활성화됩니다. 값이 없거나 비어 있거나 `0`이면 비활성 상태로 처리됩니다. `compact=1&plain=1`을 함께 사용하면 compact 처리가 먼저 실행되고 plain response에는 렌더링된 tree만 포함됩니다.

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&start=RCTView"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&compact=1&plain=1"
curl -s "http://localhost:8081/element-inspector?appId=<appId>&layoutPrecision=2"
```

Plain output은 한 줄에 node 하나를 렌더링하고, depth마다 두 칸을 들여쓰며, layout은 `[x,y,width,height]` 형식으로 표시하고, style prop은 `style={fontSize:18}` 같은 compact `style={...}` 값으로 표시합니다. `layout` 값은 JSON response와 같은 소수점 자릿수를 사용하고, 기본값은 소수점 첫째 자리입니다.

`GET /element-inspector`는 요청 시점에 앱 런타임에 새 스냅샷을 요청합니다. 캐시된 엘리먼트 트리를 반환하지 않습니다. 이 플러그인은 MCP 서버나 LLM agent가 개발 호스트에서 현재 React Native 결과물을 확인하기 위한 용도입니다.

## Network Plugin

network plugin을 만든 이유는 React Native 기본 디버거의 network panel이 이 워크플로우에 필요한 socket 가시성을 충분히 제공하지 않기 때문입니다. WebSocket 트래픽이 독립적인 스트림으로 추적되지 않고, 기본 frontend에는 socket 전용 필터가 없습니다.

`react-native-scalable-debugger-network-plugin`은 앱 측 HTTP/WebSocket instrumentation을 추가하고, 디버거가 트래픽을 확인할 수 있도록 CDP `Network` domain에 기여합니다. 또한 `patchDebuggerFrontend`를 export하며, `startCommand`와 함께 사용할 때 debugger frontend에 WebSocket category/filter를 추가합니다.

## Debugger Frontend 커스텀

기준 debugger frontend는 개별 plugin이 아니라 `startCommand`에서 설정합니다. Plugin은 start command option에 병합될 patch 함수를 노출할 수 있습니다.

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

custom base frontend를 제공하지 않으면 서버는 consuming React Native project에서 `@react-native/debugger-frontend`를 resolve하고, plugin patch를 그 frontend에 적용합니다.

## 플러그인 만들기

`ScalableDebuggerPlugin` 인터페이스를 구현하는 플러그인을 사용하여 디버거 서버를 확장할 수 있습니다. 플러그인은 클라이언트 앱에 코드를 주입하고, HTTP 및 WebSocket 엔드포인트를 노출하며, CDP(Chrome DevTools Protocol) 메시지를 가로챌 수 있습니다.

```typescript
import type { ScalableDebuggerPlugin } from 'react-native-scalable-debugger';

export const myCustomPlugin = (): ScalableDebuggerPlugin => ({
  name: 'my-custom-plugin',
  
  // 1. React Native 앱에 클라이언트 측 코드 주입
  clientEntries: [
    { importPath: require.resolve('./client/my-plugin-client') }
  ],
  
  // 2. 커스텀 HTTP REST 엔드포인트 추가
  middlewareEndpoints: [
    {
      path: '/my-custom-endpoint',
      handler: (req, res, context, next) => {
        const apps = context.socketContext.listAppConnections();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, apps: apps.length }));
      }
    }
  ],
  
  // 3. 커스텀 WebSocket 엔드포인트 추가
  websocketEndpoints: [
    {
      path: '/my-custom-ws',
      server: (req, context) => {
        // ws.WebSocketServer 인스턴스 반환
        return myWebSocketServerInstance;
      }
    }
  ],
  
  // 4. CDP(Chrome DevTools Protocol) 도메인 가로채기 또는 추가
  domains: [
    (context) => ({
      domainName: 'MyCustomDomain',
      handleDebuggerMessage: (payload) => {
        // 디버거 프론트엔드에서 오는 메시지 처리
        if (payload.method === 'MyCustomDomain.enable') {
          return true; // 전파를 막으려면 true 반환
        }
      },
      handleDeviceMessage: (payload) => {
        // 기기에서 오는 메시지 처리
      }
    })
  ]
});
```

### 플러그인 기능

- **`clientEntries`**: React Native 앱이 디버거에 연결될 때 자동으로 import 될 모듈의 절대 경로입니다. instrumentation이나 interceptor를 주입할 때 유용합니다.
- **`middlewareEndpoints`**: Metro 서버에 마운트되는 커스텀 REST API 엔드포인트입니다. 연결된 앱과 상호작용하려면 `context.socketContext`를 사용하세요.
- **`websocketEndpoints`**: 특정 경로에 Metro 서버와 함께 마운트되는 커스텀 WebSocket 서버입니다.
- **`domains`**: CDP 도메인을 위한 커스텀 핸들러입니다. 이를 통해 React Native 앱과 디버거 프론트엔드 사이의 새로운 도메인을 추가하거나 기존 도메인(예: `Network`, `Debugger`, `Runtime`)의 메시지를 가로챌 수 있습니다.

## 개발

```sh
yarn install
yarn build
yarn typecheck
```
