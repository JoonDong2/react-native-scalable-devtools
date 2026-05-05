# @react-native-scalable-devtools/react-navigation-plugin

[English](README.md)

이 plugin은 React Native debugger frontend를 patch해서 등록된 navigation state를 실시간으로 보여 주는 Navigation 탭을 추가합니다.

이 plugin은 React Navigation ref 등록을 담당합니다. UI tree를 관찰하거나 view action을 실행하지는 않습니다. 관찰에는 `@react-native-scalable-devtools/element-inspector-plugin`을, native tap이나 scroll이 필요할 때는 host-side automation tool을 사용하세요.

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

agent workflow에서 navigation state 확인과 UI action이 모두 필요하면 다른 plugin과 함께 등록할 수 있습니다.

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

if (__DEV__) {
  registerNavigationRef(navigationRef);
}

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

## Notes

이 plugin은 development와 agent automation workflow를 위한 기능입니다. 등록된 React Navigation ref를 통해 navigation state를 debugger frontend에 보여 줍니다. Native tap, gesture, OS-level back 동작을 시뮬레이션하지는 않습니다.

agent가 매칭된 React Native view를 확인한 뒤 native tap이나 scroll을 수행해야 한다면 `@react-native-scalable-devtools/element-inspector-plugin`과 host-side automation tool을 함께 사용하세요.
이 plugin에는 host-side HTTP endpoint가 없습니다.
