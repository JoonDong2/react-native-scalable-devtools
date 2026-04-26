import path from 'path';
import runServer from './runServer';
import type { Command } from '@react-native-community/cli-types';
import type { DebuggerFrontendPatch, RunServerOptions } from './runServer';
import type { CLIConfig, ServerArgs } from '../types/metro';
import type { ScalableDebuggerPlugin } from '../plugin';

export type CreateStartCommandOptions = RunServerOptions;
export type {
  DebuggerFrontendOption,
  DebuggerFrontendPatch,
  DebuggerFrontendPatchContext,
  RunServerOptions,
} from './runServer';

export function startCommand(
  ...optionFragments: CreateStartCommandOptions[]
): Command {
  const options = mergeStartCommandOptions(optionFragments);

  return {
    name: 'start',
    func: (
      argv: string[],
      cliConfig: CLIConfig,
      args: ServerArgs
    ): Promise<void> => runServer(argv, cliConfig, args, options),
    description: 'Start the React Native development server.',
    options: [
      {
        name: '--port <number>',
        parse: Number,
      },
      {
        name: '--host <string>',
        default: '',
      },
      {
        name: '--projectRoot <path>',
        description: 'Path to a custom project root',
        parse: (val: string) => path.resolve(val),
      },
      {
        name: '--watchFolders <list>',
        description:
          'Specify any additional folders to be added to the watch list',
        parse: (val: string) =>
          val.split(',').map((folder) => path.resolve(folder)),
      },
      {
        name: '--assetPlugins <list>',
        description:
          'Specify any additional asset plugins to be used by the packager by full filepath',
        parse: (val: string) => val.split(','),
      },
      {
        name: '--sourceExts <list>',
        description:
          'Specify any additional source extensions to be used by the packager',
        parse: (val: string) => val.split(','),
      },
      {
        name: '--max-workers <number>',
        description:
          'Specifies the maximum number of workers the worker-pool will spawn for transforming files.',
        parse: (workers: string) => Number(workers),
      },
      {
        name: '--transformer <string>',
        description: 'Specify a custom transformer to be used',
      },
      {
        name: '--reset-cache, --resetCache',
        description: 'Removes cached files',
      },
      {
        name: '--custom-log-reporter-path, --customLogReporterPath <string>',
        description:
          'Path to a JavaScript file that exports a log reporter as a replacement for TerminalReporter',
      },
      {
        name: '--https',
        description: 'Enables https connections to the server',
      },
      {
        name: '--key <path>',
        description: 'Path to custom SSL key',
      },
      {
        name: '--cert <path>',
        description: 'Path to custom SSL cert',
      },
      {
        name: '--config <string>',
        description: 'Path to the CLI configuration file',
        parse: (val: string) => path.resolve(val),
      },
      {
        name: '--no-interactive',
        description: 'Disables interactive mode',
      },
      {
        name: '--client-logs',
        description:
          '[Deprecated] Enable plain text JavaScript log streaming for all connected apps.',
        default: false,
      },
    ],
  };
}

export const createStartCommand = startCommand;

export default startCommand();

function mergeStartCommandOptions(
  optionFragments: readonly CreateStartCommandOptions[]
): RunServerOptions {
  const merged: RunServerOptions = {};
  const plugins: ScalableDebuggerPlugin[] = [];
  const debuggerFrontendPatches: DebuggerFrontendPatch[] = [];

  for (const options of optionFragments) {
    if (options.plugins) {
      plugins.push(...options.plugins);
    }
    if (options.debuggerFrontend !== undefined) {
      merged.debuggerFrontend = options.debuggerFrontend;
    }
    if (typeof options.debuggerFrontendPatch === 'function') {
      debuggerFrontendPatches.push(options.debuggerFrontendPatch);
    } else if (Array.isArray(options.debuggerFrontendPatch)) {
      debuggerFrontendPatches.push(...options.debuggerFrontendPatch);
    }
  }

  if (plugins.length > 0) {
    merged.plugins = plugins;
  }
  if (debuggerFrontendPatches.length > 0) {
    merged.debuggerFrontendPatch = debuggerFrontendPatches;
  }

  return merged;
}
