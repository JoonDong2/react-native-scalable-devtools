# @react-native-scalable-devtools/agent-actions-plugin

[한국어](README.ko.md)

This plugin exposes host-side endpoints that let an external agent trigger simple UI actions such as pressing a matched view or scrolling a matched scroll container in a running React Native app.

It is designed to work with `@react-native-scalable-devtools/element-inspector-plugin`. Use `/element-inspector` for UI observation and target selection, then use this plugin for semantic press and scroll actions.

React Navigation support lives in `@react-native-scalable-devtools/react-navigation-plugin`. Use that package when an agent needs to register a React Navigation ref, read navigation state, navigate, or go back.

## Maestro vs agent actions

Maestro is a black-box device automation tool. It drives the built app through the platform UI layer and usually finds targets through the accessibility tree. That makes it useful when you need realistic user input, native gesture injection, OS permission dialogs, platform UI, or validation against a production-like binary.

Maestro can still tap without `testID` or accessibility metadata when a target has visible text, when a stable nearby anchor can be used, or when you tap coordinates. The main limitation is stability: icon-only buttons, custom gesture surfaces, and views without text or accessibility metadata often require coordinate taps, and coordinate taps are device-dependent and brittle. Maestro also does not know the React Fiber tree, component props, or which nodes expose JavaScript handlers.

The element-inspector plus agent-actions flow is different:

1. Call `/element-inspector?appId=<appId>&plain=1&nodeId=1` to observe the current React Native tree with node ids.
2. Let the agent choose an action candidate by `id`, `text`, `testID`, `nativeID`, `accessibilityLabel`, `type`, `displayName`, or layout.
3. Call `/agent-actions/press` or `/agent-actions/scroll` with that target.

This is faster and more deterministic for development-time agent workflows because the action runs inside the React Native runtime. It can act on a current element-inspector `id` even when the app did not define a stable `testID`, as long as the tree has not changed between observation and action.

This combination can also control the app more precisely than a pure black-box flow. The agent can inspect the current React tree with node ids, layout bounds, text, and selected props, then target the exact Fiber node it chose instead of approximating the interaction through visible text, accessibility labels, or screen coordinates. That is useful for dense screens, repeated labels, nested touch targets, scroll containers, and agent loops that need to observe a state, choose one candidate, act, and observe again.

The tradeoff is that these are semantic JavaScript actions, not native user gestures. `/agent-actions/press` finds the matched Fiber node and invokes the nearest enabled `onPress`; `/agent-actions/scroll` calls supported scroll methods. Complex `react-native-gesture-handler` gestures, drag interactions, native-only controls, OS dialogs, and anything outside the React Native tree may still need Maestro or another native automation tool. Action execution depends on what the runtime exposes.

## Usage

### Register the plugin

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

If the same workflow also needs React Navigation control, register `@react-native-scalable-devtools/react-navigation-plugin` next to this plugin.

## Endpoints

Use `GET /apps` from the core package first when multiple apps are connected, then pass the selected `appId`.

```sh
curl -s "http://localhost:8081/apps"
```

### Observe the UI with element inspector

```sh
curl -s "http://localhost:8081/element-inspector?appId=<appId>&plain=1&nodeId=1"
```

Raw element-tree observation and target selection belong to the element inspector plugin. Pass `nodeId=1` when the agent needs to act on the observed node by id, then pass the chosen `id` back to `/agent-actions/press` or `/agent-actions/scroll`.

An LLM agent can also request the JSON response from `/element-inspector`, traverse the tree itself, and use the matching node or path it finds for control. This is useful when the agent needs exact hierarchy, layout, props, or child relationships before deciding which node to press or scroll. Sending the entire JSON tree to an LLM can consume a large number of tokens, so prefer narrowing the tree first with `start`, requesting plain text when hierarchy is enough, or extracting only the fields and subtree the agent needs.

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

For direct React Navigation actions, use `@react-native-scalable-devtools/react-navigation-plugin`. For the most realistic physical input path, combine `/element-inspector` with a host-side tool such as Maestro, adb, XCTest, or Appium and use the returned layout coordinates to drive native tap and swipe commands.
