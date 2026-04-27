# Publishing

[한국어](publishing.ko.md)

This repository publishes three npm packages:

- `react-native-scalable-debugger`
- `@react-native-scalable-debugger/network-plugin`
- `@react-native-scalable-debugger/element-inspector-plugin`

Publishing runs from `.github/workflows/publish.yml` on pushes to `main`. The workflow uses the repository `NPM_TOKEN` secret through `NODE_AUTH_TOKEN` and publishes with npm provenance enabled.

## Version Policy

The initial publish version is `0.0.1`. If a package does not exist on npm yet, the publish helper uses `0.0.1` for that package. If a package already exists on npm, the helper bumps only that package to the next patch version before publishing.

Version bump commits are created by GitHub Actions with `[skip ci]` in the commit message. Package tags use the `<package-name>@<version>` format, for example `react-native-scalable-debugger@0.0.1` or `@react-native-scalable-debugger/network-plugin@0.0.1`.

## Changed Package Selection

Only package directory changes trigger package publication. The publish helper compares the pushed base and head refs and maps changed files to these directories:

- `packages/react-native-scalable-debugger`
- `packages/network-plugin`
- `packages/element-inspector-plugin`

Root-only changes do not publish any package. If core and plugin packages change together, publishing always runs in this order:

1. `react-native-scalable-debugger`
2. `@react-native-scalable-debugger/network-plugin`
3. `@react-native-scalable-debugger/element-inspector-plugin`

## Local Dry Run

Use the helper in dry-run mode to inspect what a push would publish:

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```

Use `--assume-published` to simulate patch-bump behavior for packages that already exist on npm:

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run --assume-published
```

## Release Checks

Before pushing a release-related change, run:

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn build
yarn test
for dir in packages/react-native-scalable-debugger packages/network-plugin packages/element-inspector-plugin; do (cd "$dir" && npm pack --dry-run); done
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```
