/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @oncall react_native
 */

import createDevMiddlewareLogger from './utils/createDevMiddlewareLogger';
import isDevServerRunning from './utils/isDevServerRunning';
import loadMetroConfig from './utils/loadMetroConfig';
import * as version from './utils/version';
import { isRNGte083Server } from './utils/rnVersion';
import attachKeyHandlers from './attachKeyHandlers';
import { createDevServerMiddleware } from './middleware';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import url from 'url';
import InspectorMessageHandler from './InspectorMessageHandler';
import { DEVICE_KEY } from '../shared/constants';
import AppProxy from './AppProxy';
import { normalizePlugins } from '../plugin';
import { createClientBootstrap } from './createClientBootstrap';
import type MetroModule from 'metro';
import type { Terminal as TerminalType } from 'metro-core';
import type { CLIConfig, ServerArgs, TerminalReporter, ResolverContext, Resolution } from '../types/metro';
import type { ScalableDebuggerPlugin } from '../plugin';

// Metro, metro-core, @react-native/dev-middleware는 반드시 컨슈머(char-app)의 node_modules에서
// 로드해야 한다. 그렇지 않으면 metro-resolver가 두 인스턴스로 로드돼 사용자 customResolver의
// require('metro-resolver').resolve와 Metro 내부 resolve가 서로 다른 참조가 되어 무한 재귀가 발생한다.
function requireFromProject<T>(name: string): T {
  const resolved = require.resolve(name, { paths: [process.cwd()] });
  return require(resolved) as T;
}

type CreateDevMiddleware = typeof import('@react-native/dev-middleware').createDevMiddleware;

interface MetroConfig {
  projectRoot: string;
  server: {
    port: number;
    forwardClientLogs?: boolean;
  };
  watchFolders: readonly string[];
  resolver?: {
    resolveRequest?: (
      context: ResolverContext,
      moduleName: string,
      platform: string | null
    ) => Resolution;
  };
  transformer?: {
    assetPlugins?: string[];
  };
  reporter?: {
    update: (event: unknown) => void;
  };
  [key: string]: unknown;
}

interface MetroServer {
  keepAliveTimeout: number;
}

interface ReporterClass {
  new (terminal: TerminalType): TerminalReporter;
}

export interface RunServerOptions {
  plugins?: readonly ScalableDebuggerPlugin[];
  debuggerFrontend?: DebuggerFrontendOption;
  debuggerFrontendPatch?:
    | DebuggerFrontendPatch
    | readonly DebuggerFrontendPatch[];
}

export type DebuggerFrontendOption =
  | string
  | DebuggerFrontendPatch
  | {
      path?: string;
      sourceDist?: string;
      patch?: DebuggerFrontendPatch;
    };

export interface DebuggerFrontendPatchContext {
  sourceDist: string;
  version: string;
  projectRoot: string;
  reactNativeVersion: string;
}

export type DebuggerFrontendPatch = (
  context: DebuggerFrontendPatchContext
) => string | null | Promise<string | null>;

async function runServer(
  _argv: string[],
  cliConfig: CLIConfig,
  args: ServerArgs,
  options: RunServerOptions = {}
): Promise<void> {
  const Metro = requireFromProject<typeof MetroModule>('metro');
  const { Terminal } = requireFromProject<{ Terminal: typeof TerminalType }>('metro-core');

  const metroConfig = (await loadMetroConfig(cliConfig, {
    config: args.config,
    maxWorkers: args.maxWorkers,
    port: args.port,
    resetCache: args.resetCache,
    watchFolders: args.watchFolders,
    projectRoot: args.projectRoot,
    sourceExts: args.sourceExts,
  })) as MetroConfig;

  const hostname = args.host?.length ? args.host : 'localhost';
  const plugins = normalizePlugins(options.plugins ?? []);
  const bootstrap = createClientBootstrap(metroConfig.projectRoot, plugins);

  // 기존 사용자 resolver를 보존하면서 `../Core/InitializeCore` 상대 경로만 client로 교체한다.
  // React 렌더러가 ReactNativePrivateInitializeCore를 통해 상대 경로로 InitializeCore를 import하므로
  // 이 경로를 가로채 client 번들을 로드하면 앱 시작 시점에 CDP 훅이 설치된다.
  const prevResolveRequest = metroConfig.resolver?.resolveRequest;
  const clientPath = require.resolve('react-native-scalable-debugger/client', {
    paths: [process.cwd(), __dirname],
  });
  const packageDirs = addDebuggerWatchFolders(
    metroConfig,
    clientPath,
    bootstrap.directory,
    plugins
  );

  const {
    projectRoot,
    server: { port },
    watchFolders,
  } = metroConfig;
  const protocol = args.https === true ? 'https' : 'http';
  const devServerUrl = url.format({ protocol, hostname, port });
  // client 번들은 library node_modules 밖에서 import 되지만, react-native peer dep은
  // 반드시 컨슈머 설치본을 써야 한다. (library node_modules에 버전이 다른 react-native가
  // 남아 있을 수 있고, 그 경우 native 모듈과 JS 모듈 인스턴스가 어긋나 self 폴리필 같은
  // 전역 상태가 분리되어 runtime 에러가 발생한다.)
  const libraryDirs = new Set<string>([
    path.dirname(bootstrap.filePath),
    ...packageDirs.map((dir) => path.join(dir, 'dist')),
  ]);
  function resolveFromConsumer(moduleName: string): Resolution {
    const resolved = require.resolve(moduleName, { paths: [process.cwd()] });
    return { filePath: resolved, type: 'sourceFile' };
  }
  function isBareModule(name: string): boolean {
    return (
      !name.startsWith('.') &&
      !name.startsWith('/') &&
      !name.startsWith('\0') // rollup virtual
    );
  }
  metroConfig.resolver = metroConfig.resolver || {};
  metroConfig.resolver.resolveRequest = (
    context: ResolverContext,
    moduleName: string,
    platform: string | null
  ): Resolution => {
    if (moduleName === '../Core/InitializeCore') {
      return { filePath: bootstrap.filePath, type: 'sourceFile' };
    }
    // client 번들 내부의 bare import는 컨슈머 node_modules 기준으로 해석한다.
    const origin = context.originModulePath;
    if (
      origin &&
      Array.from(libraryDirs).some((libraryDir) => origin.startsWith(libraryDir)) &&
      isBareModule(moduleName)
    ) {
      try {
        return resolveFromConsumer(moduleName);
      } catch {
        // fallthrough to default resolver
      }
    }
    if (prevResolveRequest) {
      return prevResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  console.info(
    chalk.blue(`\nWelcome to React Native v${cliConfig.reactNativeVersion}`)
  );

  const serverStatus = await isDevServerRunning(devServerUrl, projectRoot);

  if (serverStatus === 'matched_server_running') {
    console.info(
      `A dev server is already running for this project on port ${port}. Exiting.`
    );
    return;
  } else if (serverStatus === 'port_taken') {
    console.error(
      `${chalk.red(
        'error'
      )}: Another process is running on port ${port}. Please terminate this ` +
        'process and try again, or use another port with "--port".'
    );
    return;
  }

  console.info(`Starting dev server on ${devServerUrl}\n`);

  if (args.assetPlugins) {
    metroConfig.transformer = metroConfig.transformer || {};
    metroConfig.transformer.assetPlugins = args.assetPlugins.map((plugin) =>
      require.resolve(plugin)
    );
  }
  // TODO(T214991636): Remove legacy Metro log forwarding
  if (!args.clientLogs) {
    metroConfig.server.forwardClientLogs = false;
  }

  let reportEvent: ((event: unknown) => void) | undefined;
  const terminal = new Terminal(process.stdout);
  const ReporterImpl = getReporterImpl(args.customLogReporterPath);
  const terminalReporter = new ReporterImpl(terminal);

  const {
    middleware: communityMiddleware,
    websocketEndpoints: communityWebsocketEndpoints,
    messageSocketEndpoint,
    eventsSocketEndpoint,
  } = createDevServerMiddleware({
    host: hostname,
    port,
    watchFolders,
  });

  const debuggerFrontendPath = await resolveDebuggerFrontendPath(
    options,
    {
      projectRoot,
      reactNativeVersion: cliConfig.reactNativeVersion,
    }
  );
  if (debuggerFrontendPath && isRNGte083Server(cliConfig.reactNativeVersion)) {
    process.env.REACT_NATIVE_DEBUGGER_FRONTEND_PATH = debuggerFrontendPath;
    purgePackageCache('@react-native/debugger-frontend');
    purgePackageCache('@react-native/dev-middleware');
  }

  // dev-middleware를 env 설정 이후에 lazy require 하여 커스텀 frontend 경로가 반영되게 한다.
  // 컨슈머 프로젝트의 node_modules에서 로드한다.
  const { createDevMiddleware } = requireFromProject<{
    createDevMiddleware: CreateDevMiddleware;
  }>('@react-native/dev-middleware');

  const { middleware, websocketEndpoints } = createDevMiddleware({
    projectRoot,
    serverBaseUrl: devServerUrl,
    logger: createDevMiddlewareLogger(terminalReporter),
    unstable_experiments: {
      enableNetworkInspector: true,
    },
    unstable_customInspectorMessageHandler: (connection) =>
      InspectorMessageHandler.createInspectorMessageHandler(connection, {
        plugins,
      }),
  });

  const reporter = {
    update(event: { type: string; data?: unknown[] }): void {
      // Passes only non-debugging logs.
      if (!Array.isArray(event.data) || event.data[0] !== DEVICE_KEY) {
        terminalReporter.update(event);
      }

      if (reportEvent) {
        reportEvent(event);
      }
      if (args.interactive && event.type === 'initialize_done') {
        terminalReporter.update({
          type: 'unstable_server_log',
          level: 'info',
          data: `Dev server ready. ${chalk.dim('Press Ctrl+C to exit.')}`,
        });
        attachKeyHandlers({
          devServerUrl,
          messageSocket: messageSocketEndpoint,
          reporter: terminalReporter,
        });
      }
    },
  };
  metroConfig.reporter = reporter as MetroConfig['reporter'];

  const appProxyMiddlewareEndpoint = AppProxy.createAppProxyMiddleware();

  const serverInstance = (await Metro.runServer(metroConfig, {
    host: args.host,
    secure: args.https,
    secureCert: args.cert,
    secureKey: args.key,
    unstable_extraMiddleware: [communityMiddleware, middleware],
    websocketEndpoints: {
      ...communityWebsocketEndpoints,
      ...websocketEndpoints,
      ...appProxyMiddlewareEndpoint,
    },
  })) as MetroServer;

  reportEvent = eventsSocketEndpoint.reportEvent;

  // In Node 8, the default keep-alive for an HTTP connection is 5 seconds. In
  // early versions of Node 8, this was implemented in a buggy way which caused
  // some HTTP responses (like those containing large JS bundles) to be
  // terminated early.
  //
  // As a workaround, arbitrarily increase the keep-alive from 5 to 30 seconds,
  // which should be enough to send even the largest of JS bundles.
  //
  // For more info: https://github.com/nodejs/node/issues/13391
  //
  serverInstance.keepAliveTimeout = 30000;

  await version.logIfUpdateAvailable(cliConfig, terminalReporter);
}

function purgePackageCache(name: string): void {
  try {
    const pkgJsonPath = require.resolve(`${name}/package.json`, {
      paths: [process.cwd()],
    });
    const pkgDir = path.dirname(pkgJsonPath);
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(pkgDir + path.sep) || key === pkgDir) {
        delete require.cache[key];
      }
    }
  } catch {
    // Ignore missing optional packages.
  }
}

function getReporterImpl(customLogReporterPath?: string): ReporterClass {
  if (customLogReporterPath == null) {
    // Try the new Metro >= 0.83 API first, loading from the consumer project.
    try {
      const metro = requireFromProject<{ TerminalReporter?: ReporterClass }>('metro');
      if (metro.TerminalReporter != null) {
        return metro.TerminalReporter;
      }
    } catch {
      // Ignore if metro package itself fails to load
    }

    // Fallback to legacy path for Metro < 0.83
    try {
      const legacyPath = require.resolve('metro/src/lib/TerminalReporter', {
        paths: [process.cwd()],
      });
      return require(legacyPath) as ReporterClass;
    } catch {
      throw new Error(
        'Unable to find TerminalReporter in metro package. ' +
          'Please ensure you have a compatible version of Metro installed (>= 0.83 recommended).'
      );
    }
  }
  try {
    // First we let require resolve it, so we can require packages in node_modules
    // as expected. eg: require('my-package/reporter');
    return require(customLogReporterPath) as ReporterClass;
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      throw e;
    }
    // If that doesn't work, then we next try relative to the cwd, eg:
    // require('./reporter');
    return require(path.resolve(customLogReporterPath)) as ReporterClass;
  }
}

export default runServer;

function addDebuggerWatchFolders(
  metroConfig: MetroConfig,
  clientPath: string,
  bootstrapDirectory: string,
  plugins: readonly ScalableDebuggerPlugin[]
): string[] {
  const watchFolders = new Set(metroConfig.watchFolders ?? []);
  const packageRoots = new Set<string>();
  const maybeAddPackageRoot = (resolvedPath: string): void => {
    const packageRoot = findPackageRoot(resolvedPath);
    if (packageRoot) {
      watchFolders.add(packageRoot);
      packageRoots.add(packageRoot);
    }
  };

  watchFolders.add(bootstrapDirectory);
  maybeAddPackageRoot(clientPath);
  for (const plugin of plugins) {
    for (const clientEntry of plugin.clientEntries ?? []) {
      try {
        const importPath =
          typeof clientEntry === 'string' ? clientEntry : clientEntry.importPath;
        const resolved = require.resolve(importPath, {
          paths: [process.cwd(), __dirname],
        });
        maybeAddPackageRoot(resolved);
      } catch {
        // Plugin client entries may be generated later; resolver errors will
        // still surface when Metro tries to import them.
      }
    }
  }

  metroConfig.watchFolders = Array.from(watchFolders);
  return Array.from(packageRoots);
}

function findPackageRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

async function resolveDebuggerFrontendPath(
  options: RunServerOptions,
  context: Pick<DebuggerFrontendPatchContext, 'projectRoot' | 'reactNativeVersion'>
): Promise<string | null> {
  const consumer = resolveConsumerDebuggerFrontendDist();
  const base = resolveDebuggerFrontendBase(options.debuggerFrontend, consumer);
  const patches = getDebuggerFrontendPatches(options);

  if (patches.length === 0) {
    return base.path;
  }

  let currentPath = base.path;
  let currentSourceDist = base.sourceDist;

  for (const patch of patches) {
    if (!currentSourceDist) {
      return currentPath;
    }

    const patchedPath = await patch({
      ...context,
      sourceDist: currentSourceDist,
      version: base.version,
    });

    if (patchedPath) {
      currentPath = patchedPath;
      currentSourceDist = inferDebuggerFrontendDist(patchedPath) ?? currentSourceDist;
    }
  }

  return currentPath;
}

function resolveConsumerDebuggerFrontendDist(): {
  dist: string;
  version: string;
} | null {
  try {
    const pkgPath = require.resolve('@react-native/debugger-frontend/package.json', {
      paths: [process.cwd()],
    });
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      version: string;
    };
    return { dist: path.resolve(path.dirname(pkgPath), 'dist'), version };
  } catch {
    return null;
  }
}

function resolveDebuggerFrontendBase(
  option: DebuggerFrontendOption | undefined,
  consumer: { dist: string; version: string } | null
): { path: string | null; sourceDist: string | null; version: string } {
  if (!option || typeof option === 'function') {
    return {
      path: null,
      sourceDist: consumer?.dist ?? null,
      version: consumer?.version ?? 'custom',
    };
  }

  if (typeof option === 'string') {
    return {
      path: option,
      sourceDist: inferDebuggerFrontendDist(option),
      version: consumer?.version ?? 'custom',
    };
  }

  const pathOption = option.path ?? null;
  return {
    path: pathOption,
    sourceDist:
      option.sourceDist ??
      (pathOption ? inferDebuggerFrontendDist(pathOption) : consumer?.dist) ??
      null,
    version: consumer?.version ?? 'custom',
  };
}

function getDebuggerFrontendPatches(
  options: RunServerOptions
): DebuggerFrontendPatch[] {
  const patches: DebuggerFrontendPatch[] = [];
  const { debuggerFrontend, debuggerFrontendPatch } = options;

  if (typeof debuggerFrontend === 'function') {
    patches.push(debuggerFrontend);
  } else if (
    debuggerFrontend &&
    typeof debuggerFrontend !== 'string' &&
    debuggerFrontend.patch
  ) {
    patches.push(debuggerFrontend.patch);
  }

  if (typeof debuggerFrontendPatch === 'function') {
    patches.push(debuggerFrontendPatch);
  } else if (Array.isArray(debuggerFrontendPatch)) {
    patches.push(...debuggerFrontendPatch);
  }

  return patches;
}

function inferDebuggerFrontendDist(frontendPath: string): string {
  const resolved = path.resolve(frontendPath);
  if (fs.existsSync(path.join(resolved, 'third-party/front_end'))) {
    return resolved;
  }
  if (
    path.basename(resolved) === 'front_end' &&
    path.basename(path.dirname(resolved)) === 'third-party'
  ) {
    return path.dirname(path.dirname(resolved));
  }
  return resolved;
}
