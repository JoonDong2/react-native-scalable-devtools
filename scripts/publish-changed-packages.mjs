#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const INITIAL_VERSION = '0.0.1';
const ALL_ZERO_SHA = /^0+$/;

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const PACKAGES = [
  {
    name: '@react-native-scalable-devtools/cli',
    directory: 'packages/cli',
  },
  {
    name: '@react-native-scalable-devtools/network-plugin',
    directory: 'packages/network-plugin',
  },
  {
    name: '@react-native-scalable-devtools/element-inspector-plugin',
    directory: 'packages/element-inspector-plugin',
  },
  {
    name: '@react-native-scalable-devtools/react-navigation-plugin',
    directory: 'packages/react-navigation-plugin',
  },
  {
    name: '@react-native-scalable-devtools/react-query-plugin',
    directory: 'packages/react-query-plugin',
  },
  {
    name: '@react-native-scalable-devtools/agent-actions-plugin',
    directory: 'packages/agent-actions-plugin',
  },
];

const options = parseArgs(process.argv.slice(2));

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main() {
  const head = resolveHead(options.head ?? process.env.GITHUB_SHA ?? 'HEAD');
  const base = resolveBase(options.base ?? process.env.GITHUB_EVENT_BEFORE, head);
  const changedFiles = getChangedFiles(base, head);
  const changedPackages = PACKAGES.filter((pkg) =>
    changedFiles.some((file) => isPathInside(file, pkg.directory))
  );

  log(`Base: ${base}`);
  log(`Head: ${head}`);
  log(`Changed files: ${changedFiles.length}`);

  if (changedPackages.length === 0) {
    log('No publishable package changes detected.');
    return;
  }

  log(
    `Publish candidates: ${changedPackages
      .map((pkg) => pkg.name)
      .join(', ')}`
  );

  if (!options.dryRun && !process.env.NODE_AUTH_TOKEN) {
    throw new Error('NODE_AUTH_TOKEN is required to publish packages.');
  }

  const publishResults = changedPackages.map((pkg) => publishPackage(pkg));
  commitVersionBumps();

  log('Publish results:');
  for (const result of publishResults) {
    log(`- ${result.name}@${result.version}${result.skipped ? ' (already published)' : ''}`);
  }
}

function publishPackage(pkg) {
  const packageDirectory = path.join(REPO_ROOT, pkg.directory);
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  const packageJson = readPackageJson(packageJsonPath);
  const currentVersion = packageJson.version;
  const publishedInfo = getPublishedPackageInfo(pkg.name);

  if (publishedInfo?.gitHead === options.resolvedHead) {
    log(
      `${pkg.name}: ${publishedInfo.version} is already published for ${options.resolvedHead}; ensuring tag only`
    );
    createPackageTag(pkg.name, publishedInfo.version);
    return {
      name: pkg.name,
      version: publishedInfo.version,
      skipped: true,
    };
  }

  const nextVersion = publishedInfo
    ? incrementPatch(maxVersion(currentVersion, publishedInfo.version))
    : INITIAL_VERSION;

  log(
    publishedInfo
      ? `${pkg.name}: npm latest is ${publishedInfo.version}; publishing ${nextVersion}`
      : `${pkg.name}: not found on npm; publishing ${nextVersion}`
  );

  if (currentVersion !== nextVersion) {
    if (options.dryRun) {
      log(`[dry-run] set ${pkg.name} version ${currentVersion} -> ${nextVersion}`);
    } else {
      packageJson.version = nextVersion;
      writePackageJson(packageJsonPath, packageJson);
    }
  }

  if (options.dryRun) {
    log(`[dry-run] npm publish --provenance --access public (${pkg.directory})`);
  } else {
    run('npm', ['publish', '--provenance', '--access', 'public'], {
      cwd: packageDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN,
      },
    });
  }

  createPackageTag(pkg.name, nextVersion);

  return {
    name: pkg.name,
    version: nextVersion,
    skipped: false,
  };
}

function createPackageTag(packageName, version) {
  const tagName = `${packageName}@${version}`;
  if (options.dryRun) {
    log(`[dry-run] git tag -a ${tagName} -m ${tagName}`);
    return;
  }

  if (gitRefExists(`refs/tags/${tagName}`)) {
    log(`Tag already exists: ${tagName}`);
    return;
  }

  run('git', ['tag', '-a', tagName, '-m', tagName]);
}

function commitVersionBumps() {
  if (options.dryRun) {
    log('[dry-run] skip release commit');
    return;
  }

  const changedPackageJsonPaths = PACKAGES.map((pkg) =>
    path.join(pkg.directory, 'package.json')
  ).filter((file) => hasWorktreeChanges(file));

  if (changedPackageJsonPaths.length === 0) {
    log('No version bump commit needed.');
    return;
  }

  run('git', ['add', ...changedPackageJsonPaths]);
  if (commandSucceeds('git', ['diff', '--cached', '--quiet'])) {
    log('No staged version bump changes.');
    return;
  }

  run('git', [
    'commit',
    '-m',
    'chore(release): publish packages [skip ci]',
  ]);
}

function getChangedFiles(base, head) {
  const output = run('git', ['diff', '--name-only', base, head]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function getPublishedPackageInfo(packageName) {
  if (options.dryRun) {
    if (options.assumePublishedCurrent) {
      return {
        version: getCurrentPackageVersion(packageName),
        gitHead: options.resolvedHead,
      };
    }
    if (options.assumePublished) {
      return {
        version: getCurrentPackageVersion(packageName),
        gitHead: 'previous-published-commit',
      };
    }
    return undefined;
  }

  try {
    const output = run('npm', ['view', packageName, 'version', 'gitHead', '--json'], {
      stdio: 'pipe',
    });
    const value = JSON.parse(output.trim());
    if (typeof value === 'string') {
      return {
        version: value,
        gitHead: undefined,
      };
    }
    if (value && typeof value.version === 'string') {
      return {
        version: value.version,
        gitHead: typeof value.gitHead === 'string' ? value.gitHead : undefined,
      };
    }
    return undefined;
  } catch (error) {
    const text = [
      error.stdout?.toString('utf8'),
      error.stderr?.toString('utf8'),
      error.message,
    ]
      .filter(Boolean)
      .join('\n');
    if (text.includes('E404') || text.includes('404 Not Found')) {
      return undefined;
    }
    throw error;
  }
}

function getCurrentPackageVersion(packageName) {
  return readPackageJson(
    path.join(REPO_ROOT, getPackage(packageName).directory, 'package.json')
  ).version;
}

function resolveHead(head) {
  const resolved = run('git', ['rev-parse', head]).trim();
  options.resolvedHead = resolved;
  return resolved;
}

function resolveBase(base, head) {
  if (base && !ALL_ZERO_SHA.test(base)) {
    return base;
  }

  if (base && ALL_ZERO_SHA.test(base)) {
    return getEmptyTreeHash();
  }

  try {
    return run('git', ['rev-parse', `${head}^`]).trim();
  } catch {
    return getEmptyTreeHash();
  }
}

function getEmptyTreeHash() {
  return run('git', ['hash-object', '-t', 'tree', '/dev/null']).trim();
}

function hasWorktreeChanges(file) {
  return !commandSucceeds('git', ['diff', '--quiet', '--', file]);
}

function gitRefExists(ref) {
  return commandSucceeds('git', ['rev-parse', '--verify', '--quiet', ref]);
}

function getPackage(packageName) {
  const pkg = PACKAGES.find((candidate) => candidate.name === packageName);
  if (!pkg) {
    throw new Error(`Unknown package: ${packageName}`);
  }
  return pkg;
}

function readPackageJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writePackageJson(filePath, packageJson) {
  writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function maxVersion(left, right) {
  return compareVersions(left, right) >= 0 ? left : right;
}

function incrementPatch(version) {
  const parsed = parseVersion(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function compareVersions(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (leftParsed[key] !== rightParsed[key]) {
      return leftParsed[key] - rightParsed[key];
    }
  }
  return 0;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isPathInside(file, directory) {
  return file === directory || file.startsWith(`${directory}/`);
}

function parseArgs(argv) {
  const parsed = {
    base: undefined,
    head: undefined,
    dryRun: false,
    assumePublished: false,
    assumePublishedCurrent: false,
    resolvedHead: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      parsed.base = readArgValue(argv, ++index, arg);
    } else if (arg.startsWith('--base=')) {
      parsed.base = arg.slice('--base='.length);
    } else if (arg === '--head') {
      parsed.head = readArgValue(argv, ++index, arg);
    } else if (arg.startsWith('--head=')) {
      parsed.head = arg.slice('--head='.length);
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--assume-published') {
      parsed.assumePublished = true;
    } else if (arg === '--assume-published-current') {
      parsed.assumePublishedCurrent = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function readArgValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function commandSucceeds(command, args) {
  try {
    run(command, args);
    return true;
  } catch {
    return false;
  }
}

function log(message) {
  console.log(message);
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/publish-changed-packages.mjs [options]

Options:
  --base <sha>                    Base git ref for changed-file detection.
  --head <sha>                    Head git ref for changed-file detection. Default: HEAD.
  --dry-run                       Print planned publish actions without changing files or npm.
  --assume-published              In dry-run mode, simulate packages as already published by an older commit.
  --assume-published-current      In dry-run mode, simulate packages as already published by the current commit.
  -h, --help                      Show this help.
`);
  process.exit(0);
}
