# react-native-scalable-debugger

[English](README.md)

플러그인 지향 React Native 디버거 서버를 위한 모노레포입니다.

## 패키지

- `react-native-scalable-debugger`: 코어 서버, 클라이언트 부트스트랩, 플러그인 API.
- `@react-native-scalable-debugger/network-plugin`: `react-native-network-debugger`에서 분리한 네트워크 패널 플러그인.
- `@react-native-scalable-debugger/element-inspector-plugin`: 현재 앱 화면의 엘리먼트 스냅샷을 제공하는 플러그인.

각 패키지는 `packages/*/README.md`에 별도 README를 가집니다. 코어 패키지 README에는 AppProxy, `/apps`, `/element-inspector`, network plugin, debugger-frontend 커스텀에 대한 전체 설명이 포함되어 있습니다.

## 개발

```sh
yarn install
yarn build
yarn typecheck
```
