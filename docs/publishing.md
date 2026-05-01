# Publishing

[한국어](publishing.ko.md)

This repository publishes three npm packages:

- `@react-native-scalable-devtools/cli`
- `@react-native-scalable-devtools/network-plugin`
- `@react-native-scalable-devtools/element-inspector-plugin`
- `@react-native-scalable-devtools/agent-actions-plugin`

Publishing runs from `.github/workflows/publish.yml` on pushes to `main`. The workflow uses the repository `NPM_TOKEN` secret through `NODE_AUTH_TOKEN` and publishes with npm provenance enabled.

The plugin packages are intentionally published as unscoped package names, so publishing does not require an npm organization or scope. `NPM_TOKEN` still needs publish access for each package name being released.

## Version Policy

The initial publish version is `0.0.1`. If a package does not exist on npm yet, the publish helper uses `0.0.1` for that package. If a package already exists on npm, the helper bumps only that package to the next patch version before publishing.

Version bump commits are created by GitHub Actions with `[skip ci]` in the commit message. Package tags use the `<package-name>@<version>` format, for example `@react-native-scalable-devtools/cli@0.0.1` or `@react-native-scalable-devtools/network-plugin@0.0.1`.

## Changed Package Selection

Only package directory changes trigger package publication. The publish helper compares the pushed base and head refs and maps changed files to these directories:

- `packages/cli`
- `packages/network-plugin`
- `packages/element-inspector-plugin`

Root-only changes do not publish any package. If core and plugin packages change together, publishing always runs in this order:

1. `@react-native-scalable-devtools/cli`
2. `@react-native-scalable-devtools/network-plugin`
3. `@react-native-scalable-devtools/element-inspector-plugin`
4. `@react-native-scalable-devtools/agent-actions-plugin`

## Local Dry Run

Use the helper in dry-run mode to inspect what a push would publish:

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```

Use `--assume-published` to simulate patch-bump behavior for packages that already exist on npm:

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run --assume-published
```

Use `--assume-published-current` to simulate a retry where the same commit was already published and only tags need to be restored:

```sh
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run --assume-published-current
```

## Release Checks

Before pushing a release-related change, run:

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn build
yarn test
for dir in packages/cli packages/network-plugin packages/element-inspector-plugin packages/agent-actions-plugin; do (cd "$dir" && npm pack --dry-run); done
node scripts/publish-changed-packages.mjs --base HEAD~1 --head HEAD --dry-run
```
