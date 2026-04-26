# react-native-scalable-debugger

[한국어](README.ko.md)

Monorepo for a plugin-oriented React Native debugger server.

## Packages

- `react-native-scalable-debugger`: core server, client bootstrap, and plugin API.
- `@react-native-scalable-debugger/network-plugin`: Network panel plugin split from `react-native-network-debugger`.
- `@react-native-scalable-debugger/element-inspector-plugin`: Element inspector plugin for app snapshots.

Each package has its own README under `packages/*/README.md`. The core package README includes the complete AppProxy, `/apps`, `/element-inspector`, network plugin, and debugger-frontend customization overview.

## Development

```sh
yarn install
yarn build
yarn typecheck
```
