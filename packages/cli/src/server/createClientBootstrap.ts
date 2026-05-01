import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NormalizedScalableDebuggerPlugin } from '../plugin';

export interface ClientBootstrap {
  filePath: string;
  directory: string;
}

export function createClientBootstrap(
  projectRoot: string,
  plugins: readonly NormalizedScalableDebuggerPlugin[]
): ClientBootstrap {
  const hash = crypto
    .createHash('sha1')
    .update(projectRoot)
    .digest('hex')
    .slice(0, 12);
  const directory = path.join(os.tmpdir(), 'rn-scalable-debugger', hash);
  const filePath = path.join(directory, 'InitializeCore.js');
  const imports = plugins.flatMap((plugin) =>
    plugin.clientEntries.map((entry) => entry.importPath)
  );
  const content = [
    "import 'react-native/Libraries/Core/InitializeCore.js';",
    "import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';",
    ...imports.map((importPath) => `import ${JSON.stringify(importPath)};`),
    'DebuggerConnection.connect();',
    '',
  ].join('\n');

  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) {
    fs.writeFileSync(filePath, content);
  }

  const realDirectory = fs.realpathSync(directory);
  return {
    filePath: path.join(realDirectory, path.basename(filePath)),
    directory: realDirectory,
  };
}
