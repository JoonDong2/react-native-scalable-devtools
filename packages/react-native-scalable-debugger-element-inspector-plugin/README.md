# @react-native-scalable-debugger/element-inspector-plugin

Element tree inspector plugin for `react-native-scalable-debugger`.

## Usage

```js
const { startCommand } = require('react-native-scalable-debugger');
const {
  elementInspectorPlugin,
} = require('@react-native-scalable-debugger/element-inspector-plugin');

module.exports = {
  commands: [startCommand(elementInspectorPlugin())],
};
```

When the React Native app is connected to Metro:

```sh
curl -s "http://localhost:8081/element-inspector?appId=<id>"
```

Use `GET /apps` to list connected apps and select an `appId`.
The REST endpoint accepts only `appId` and `timeoutMs` query parameters.

`GET /element-inspector` always asks the app runtime for a fresh snapshot. It
does not return a cached element tree.
