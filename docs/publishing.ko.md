# Publishing

[English](publishing.md)

이 repository는 세 npm package를 배포합니다.

- `@react-native-scalable-devtools/cli`
- `@react-native-scalable-devtools/network-plugin`
- `@react-native-scalable-devtools/element-inspector-plugin`
- `@react-native-scalable-devtools/agemt-actions-plugin`

배포는 `main` branch push 시 `.github/workflows/publish.yml`에서 실행됩니다. Workflow는 repository의 `NPM_TOKEN` secret을 `NODE_AUTH_TOKEN`으로 사용하고, npm provenance를 활성화해 publish합니다.

Plugin package는 의도적으로 unscoped package name으로 배포하므로 npm organization이나 scope가 필요하지 않습니다. `NPM_TOKEN`에는 배포할 각 package name에 대한 publish 권한이 필요합니다.

## Version 정책

첫 배포 version은 `0.0.1`입니다. Package가 아직 npm에 없으면 publish helper는 해당 package를 `0.0.1`로 배포합니다. Package가 이미 npm에 있으면 해당 package만 다음 patch version으로 올린 뒤 배포합니다.

Version bump commit은 GitHub Actions가 만들며 commit message에 `[skip ci]`를 포함합니다. Package tag는 `<package-name>@<version>` 형식을 사용합니다. 예: `@react-native-scalable-devtools/cli@0.0.1`, `@react-native-scalable-devtools/network-plugin@0.0.1`.

## 변경 package 선택

Package directory 변경만 package publish를 트리거합니다. Publish helper는 push된 base와 head ref를 비교하고 변경 파일을 다음 directory에 매핑합니다.

- `packages/cli`
- `packages/network-plugin`
- `packages/element-inspector-plugin`

Root-only 변경은 어떤 package도 배포하지 않습니다. Core와 plugin package가 함께 변경되면 항상 다음 순서로 배포합니다.

1. `@react-native-scalable-devtools/cli`
2. `@react-native-scalable-devtools/network-plugin`
3. `@react-native-scalable-devtools/element-inspector-plugin`
4. `@react-native-scalable-devtools/agemt-actions-plugin`

## Local Dry Run

Push 시 어떤 package가 배포될지 확인하려면 helper를 dry-run으로 실행합니다.

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```

이미 npm에 존재하는 package의 patch bump 동작을 시뮬레이션하려면 `--assume-published`를 사용합니다.

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run --assume-published
```

같은 commit이 이미 publish되어 tag만 복구하면 되는 retry 상황은 `--assume-published-current`로 시뮬레이션합니다.

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run --assume-published-current
```

## Release Checks

Release 관련 변경을 push하기 전에 다음 명령을 실행합니다.

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn build
yarn test
for dir in packages/cli packages/network-plugin packages/element-inspector-plugin packages/agent-actions-plugin; do (cd "$dir" && npm pack --dry-run); done
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```
