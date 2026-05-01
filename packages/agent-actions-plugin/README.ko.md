# react-native-agent-actions-plugin

[English](README.md)

이 plugin은 외부 agent가 실행 중인 React Native 앱에서 target을 resolve하고, React Navigation으로 화면을 이동하고, 특정 view를 press하거나 scroll container를 스크롤할 수 있도록 host-side endpoint를 제공합니다.

`react-native-scalable-debugger-element-inspector-plugin`과 함께 쓰도록 설계했습니다. Raw UI 관찰은 `/element-inspector`를 사용하고, 이 plugin은 target resolve와 semantic action에 사용하세요.

## 사용법

### plugin 등록

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  elementInspectorPlugin,
} = require('react-native-scalable-debugger-element-inspector-plugin');
const {
  agentActionsPlugin,
} = require('react-native-agent-actions-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin(), agentActionsPlugin())],
};
```

### React Navigation ref 등록

plugin이 navigation container를 자동으로 찾지는 않습니다. 앱에서 navigation ref를 만들고 client entry에 등록해야 합니다.

```ts
import { createNavigationContainerRef } from '@react-navigation/native';
import { registerNavigationRef } from 'react-native-agent-actions-plugin/client';

export const navigationRef = createNavigationContainerRef();

registerNavigationRef(navigationRef);
```

```tsx
<NavigationContainer ref={navigationRef}>
  {/* screens */}
</NavigationContainer>
```

## Endpoints

여러 앱이 연결되어 있으면 core package의 `GET /apps`를 먼저 호출하고 선택한 `appId`를 전달하세요.

```sh
curl -s "http://localhost:8081/apps"
```

### Element inspector로 UI 관찰

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1&compact=1&nodeId=1"
```

Raw element-tree 관찰 책임은 element inspector plugin에 있습니다. Compact와 plain element-inspector output은 `nodeId=1`이 활성화되었을 때 node `id`를 유지하므로, agent는 압축된 tree에서 `id`를 고른 뒤 `/agent-actions/press` 또는 `/agent-actions/scroll`에 다시 전달할 수 있습니다.

### View resolve

```sh
curl -s -X POST "http://localhost:8081/agent-actions/resolve-view" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","query":"login button"}'
```

Target은 `id`, `testID`, `nativeID`, `accessibilityLabel`, `text`, `type`, `displayName`, 넓은 의미의 `query`로 찾을 수 있습니다.

```json
{
  "target": {
    "text": "Log in"
  }
}
```

### Navigate

```sh
curl -s -X POST "http://localhost:8081/agent-actions/navigation/navigate" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","name":"Settings","params":{"tab":"profile"}}'
```

runtime에서 등록된 `navigationRef.navigate(...)`를 호출합니다.

### Go back

```sh
curl -s -X POST "http://localhost:8081/agent-actions/navigation/back" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>"}'
```

### Navigation state

```sh
curl -s "http://localhost:8081/agent-actions/navigation/state?appId=<appId>"
```

### Press

```sh
curl -s -X POST "http://localhost:8081/agent-actions/press" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","target":{"id":"root.0.1"}}'
```

runtime이 매칭되는 Fiber node를 찾고, 가장 가까운 enabled `onPress`를 찾아 작은 synthetic press event와 함께 호출합니다. 이것은 native touch injection이 아니라 JavaScript semantic action입니다.

### Scroll

```sh
curl -s -X POST "http://localhost:8081/agent-actions/scroll" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","target":{"query":"settings list"},"direction":"down","amount":400}'
```

runtime이 매칭되는 scrollable component를 찾고 가능한 경우 `scrollTo`, `scrollToOffset`, `scrollToEnd`를 호출합니다. 상대 방향 스크롤은 이 plugin이 mounted target별로 추적하므로 agent가 제어하는 흐름에 가장 적합합니다.

## Notes

이 plugin은 development와 agent automation workflow를 위한 기능입니다. JS semantic action이 실제 사용자나 device automation tool의 native gesture와 완전히 같다고 보장하지는 않습니다.

가장 현실적인 physical input path가 필요하면 `/element-inspector`를 Maestro, adb, XCTest, Appium 같은 host-side tool과 함께 사용하고, 반환된 layout 좌표로 native tap과 swipe를 실행하세요.
