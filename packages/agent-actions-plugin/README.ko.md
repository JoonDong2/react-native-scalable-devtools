# @react-native-scalable-devtools/agent-actions-plugin

[English](README.md)

이 plugin은 외부 agent가 실행 중인 React Native 앱에서 특정 view를 press하거나 scroll container를 스크롤할 수 있도록 host-side endpoint를 제공합니다.

`@react-native-scalable-devtools/element-inspector-plugin`과 함께 쓰도록 설계했습니다. UI 관찰과 target 선택은 `/element-inspector`를 사용하고, 이 plugin은 semantic press와 scroll action에 사용하세요.

React Navigation 지원은 `@react-native-scalable-devtools/react-navigation-plugin`에 있습니다. agent가 React Navigation ref를 등록하고, navigation state를 읽고, navigate 하거나 go back 해야 한다면 해당 package를 사용하세요.

## Maestro vs agent actions

Maestro는 black-box device automation 도구입니다. 빌드된 앱을 platform UI layer에서 제어하고, target은 보통 accessibility tree를 통해 찾습니다. 실제 사용자 입력, native gesture injection, OS permission dialog, platform UI, production에 가까운 binary 검증이 필요할 때 유용합니다.

Maestro는 target에 visible text가 있거나, 주변의 안정적인 anchor를 사용할 수 있거나, 좌표를 직접 탭할 수 있으면 `testID`나 accessibility metadata가 없어도 제어할 수 있습니다. 주요 제약은 안정성입니다. icon-only button, custom gesture surface, text나 accessibility metadata가 없는 view는 좌표 tap이 필요해지는 경우가 많고, 좌표 tap은 device-dependent하고 brittle합니다. Maestro는 React Fiber tree, component props, 어떤 node가 JavaScript handler를 노출하는지도 알 수 없습니다.

element-inspector와 agent-actions 조합은 다르게 동작합니다.

1. `/element-inspector?appId=<appId>&plain=1&nodeId=1`을 호출해 node id가 포함된 현재 React Native tree를 관찰합니다.
2. agent가 `id`, `text`, `testID`, `nativeID`, `accessibilityLabel`, `type`, `displayName`, layout 중 하나를 기준으로 action 후보를 고릅니다.
3. 해당 target으로 `/agent-actions/press` 또는 `/agent-actions/scroll`을 호출합니다.

이 방식은 action이 React Native runtime 안에서 실행되므로 development-time agent workflow에서는 더 빠르고 deterministic할 수 있습니다. 앱이 안정적인 `testID`를 정의하지 않았더라도, 관찰과 action 사이에 tree가 바뀌지 않았다면 현재 element-inspector `id`로 action할 수 있습니다.

이 조합은 순수 black-box 흐름보다 더 정교하게 앱을 조작할 수도 있습니다. agent는 현재 React tree의 node id, layout bounds, text, 선별된 props를 확인한 뒤, visible text, accessibility label, 화면 좌표로 상호작용을 추정하는 대신 자신이 고른 정확한 Fiber node를 target으로 지정할 수 있습니다. 조밀한 화면, 반복되는 label, 중첩된 touch target, scroll container, 그리고 상태를 관찰한 뒤 후보 하나를 고르고 action 후 다시 관찰해야 하는 agent loop에서 특히 유용합니다.

대신 이것은 native user gesture가 아니라 semantic JavaScript action입니다. `/agent-actions/press`는 매칭된 Fiber node를 찾고 가장 가까운 enabled `onPress`를 호출합니다. `/agent-actions/scroll`은 지원되는 scroll method를 호출합니다. 복잡한 `react-native-gesture-handler` gesture, drag interaction, native-only control, OS dialog, React Native tree 밖의 UI는 여전히 Maestro나 다른 native automation 도구가 필요할 수 있습니다. Action 실행 가능 여부는 runtime이 무엇을 노출하는지에 달려 있습니다.

## 사용법

### plugin 등록

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');
const {
  agentActionsPlugin,
} = require('@react-native-scalable-devtools/agent-actions-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin(), agentActionsPlugin())],
};
```

같은 workflow에서 React Navigation 제어도 필요하다면 `@react-native-scalable-devtools/react-navigation-plugin`을 이 plugin과 함께 등록하세요.

## Endpoints

여러 앱이 연결되어 있으면 core package의 `GET /apps`를 먼저 호출하고 선택한 `appId`를 전달하세요.

```sh
curl -s "http://localhost:8081/apps"
```

### Element inspector로 UI 관찰

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1&nodeId=1"
```

Raw element-tree 관찰과 target 선택 책임은 element inspector plugin에 있습니다. 관찰한 node를 id로 action해야 한다면 `nodeId=1`을 전달하고, 선택한 `id`를 `/agent-actions/press` 또는 `/agent-actions/scroll`에 다시 전달하세요.

LLM agent는 `/element-inspector`의 JSON response를 요청한 뒤 tree를 순회해서 제어에 사용할 node나 path를 찾을 수도 있습니다. Hierarchy, layout, props, child 관계를 정확히 확인한 뒤 press 또는 scroll target을 결정해야 할 때 유용합니다. 다만 전체 JSON tree를 그대로 LLM에 입력하면 token을 많이 소모할 수 있으므로 권장하지 않습니다. 가능하면 `start`로 tree를 먼저 좁히거나, hierarchy만 필요할 때는 plain text를 요청하거나, agent에 필요한 field와 subtree만 추출해서 전달하세요.

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

직접 React Navigation action이 필요하면 `@react-native-scalable-devtools/react-navigation-plugin`을 사용하세요. 가장 현실적인 physical input path가 필요하면 `/element-inspector`를 Maestro, adb, XCTest, Appium 같은 host-side tool과 함께 사용하고, 반환된 layout 좌표로 native tap과 swipe를 실행하세요.
