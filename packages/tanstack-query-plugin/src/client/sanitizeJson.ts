import type { JSONValue } from '../shared/protocol';

export function sanitizeJson(value: unknown): JSONValue {
  return sanitizeValue(value, 0, new WeakSet<object>()) ?? null;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): JSONValue | undefined {
  if (value == null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value !== 'object') {
    return null;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= 8) {
    return '[MaxDepth]';
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item, depth + 1, seen))
      .filter((item): item is JSONValue => item !== undefined);
    seen.delete(value);
    return items;
  }

  const output: Record<string, JSONValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeValue(child, depth + 1, seen);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }
  seen.delete(value);
  return output;
}
