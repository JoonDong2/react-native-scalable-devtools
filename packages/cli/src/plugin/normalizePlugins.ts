import type {
  ClientEntryContribution,
  NormalizedScalableDebuggerPlugin,
  ScalableDebuggerPlugin,
} from './types';

function normalizeClientEntry(
  entry: string | ClientEntryContribution
): ClientEntryContribution {
  return typeof entry === 'string' ? { importPath: entry } : entry;
}

export function normalizePlugins(
  plugins: readonly ScalableDebuggerPlugin[] = []
): readonly NormalizedScalableDebuggerPlugin[] {
  const seen = new Set<string>();

  return plugins.map((plugin) => {
    const name = plugin.name?.trim();
    if (!name) {
      throw new Error('Scalable debugger plugin name is required.');
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate scalable debugger plugin name: ${name}`);
    }
    seen.add(name);

    const clientEntries = (plugin.clientEntries ?? []).map(normalizeClientEntry);

    return {
      ...plugin,
      name,
      clientEntries,
    };
  });
}
