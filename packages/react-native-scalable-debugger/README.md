# react-native-scalable-debugger

[한국어](README.ko.md)

Core server, AppProxy, plugin API, and `startCommand` for the plugin-oriented React Native debugger server.

This is the main package of the `react-native-scalable-debugger` monorepo. It exposes the essential components needed to create a scalable debugging environment for React Native and acts as the foundation for other plugins.

## App Device Metadata

`GET /apps` returns each connected app with `deviceInfo.deviceId` metadata for external automation tools such as Maestro. `appId` remains the public selector for debugger requests; `deviceInfo.deviceId` is only metadata for tools that need the underlying Android or iOS device identifier.

Device identifiers are resolved in this order:

1. The app runtime reports `deviceInfo.deviceId` from React Native `Platform.constants` when a native identifier is available.
2. If the runtime does not provide an identifier, the server enriches `/apps` from host-side tools. Android uses `adb devices -l`; iOS uses `xcrun simctl list --json devices booted` for simulators and `xcrun devicectl list devices --json-output -` or `xcrun xctrace list devices` for physical devices.
3. Host devices are matched to the connected app by comparable runtime metadata such as device name, model, and OS version. If there is only one host device for the app platform, that device id is used as the fallback match.

When no Android or iOS device identifier can be resolved, `deviceInfo.deviceId` is set to `"unknown"`.

For full usage instructions, endpoint documentation, and information on how to create your own plugins, please see the [Monorepo README](../../README.md).
