# @react-native-scalable-devtools/agemt-actions-plugin

[한국어](README.ko.md)

This plugin exposes host-side endpoints that let an external agent resolve targets in a running React Native app, navigate through React Navigation, and trigger simple UI actions such as pressing a matched view or scrolling a matched scroll container.

It is designed to work with `@react-native-scalable-devtools/element-inspector-plugin`. Use `/element-inspector` for raw UI observation, then use this plugin for target resolution and semantic actions.

## Usage

### Register the plugin

```js
const { startCommand } = require('@react-native-scalable-devtools/cli');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-devtools/element-inspector-plugin');
const {
  agentActionsPlugin,
} = require('@react-native-scalable-devtools/agemt-actions-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin(), agentActionsPlugin())],
};
```

### Register a React Navigation ref

The plugin cannot discover your navigation container by itself. Create the navigation ref in the app and register it with the client entry.

```ts
import { createNavigationContainerRef } from '@react-navigation/native';
import { registerNavigationRef } from '@react-native-scalable-devtools/agemt-actions-plugin/client';

export const navigationRef = createNavigationContainerRef();

registerNavigationRef(navigationRef);
```

```tsx
<NavigationContainer ref={navigationRef}>
  {/* screens */}
</NavigationContainer>
```

## Endpoints

Use `GET /apps` from the core package first when multiple apps are connected, then pass the selected `appId`.

```sh
curl -s "http://localhost:8081/apps"
```

### Observe the UI with element inspector

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1&compact=1&nodeId=1"
```

Raw element-tree observation belongs to the element inspector plugin. Compact and plain element-inspector output keeps node `id` values when `nodeId=1` is enabled, so an agent can choose an `id` from that compressed tree and pass it back to `/agent-actions/press` or `/agent-actions/scroll`.

### Resolve a view

```sh
curl -s -X POST "http://localhost:8081/agent-actions/resolve-view" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","query":"login button"}'
```

Targets can match `id`, `testID`, `nativeID`, `accessibilityLabel`, `text`, `type`, `displayName`, or a broad `query`.

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

The runtime calls the registered `navigationRef.navigate(...)`.

### Go back

```sh
curl -s -X POST "http://localhost:8081/agent-actions/navigation/back" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>"}'
```

### Get navigation state

```sh
curl -s "http://localhost:8081/agent-actions/navigation/state?appId=<appId>"
```

### Press

```sh
curl -s -X POST "http://localhost:8081/agent-actions/press" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","target":{"id":"root.0.1"}}'
```

The runtime finds the matching Fiber node, walks to the nearest enabled `onPress`, and calls it with a small synthetic press event. This is a semantic JavaScript action, not a native touch injection.

### Scroll

```sh
curl -s -X POST "http://localhost:8081/agent-actions/scroll" \
  -H "Content-Type: application/json" \
  -d '{"appId":"<appId>","target":{"query":"settings list"},"direction":"down","amount":400}'
```

The runtime finds a matching scrollable component and calls `scrollTo`, `scrollToOffset`, or `scrollToEnd` when available. Relative direction scrolling is tracked per mounted target by this plugin, so it is best suited for agent-controlled flows.

## Notes

This plugin is for development and agent automation workflows. It does not try to guarantee that JS semantic actions are identical to native gestures from a user or a device automation tool.

For the most realistic physical input path, combine `/element-inspector` with a host-side tool such as Maestro, adb, XCTest, or Appium and use the returned layout coordinates to drive native tap and swipe commands.
