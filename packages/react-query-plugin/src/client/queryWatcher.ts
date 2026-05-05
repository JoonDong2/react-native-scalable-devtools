import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  REACT_QUERY_CDP_QUERIES_UPDATED_METHOD,
  type ReactQueryQuerySnapshot,
  type ReactQuerySnapshot,
} from '../shared/protocol';
import {
  addQueryClientListener,
  getQueryCache,
  getQueryClient,
  type QueryCacheLike,
  type QueryClientLike,
} from './queryClient';
import { sanitizeJson } from './sanitizeJson';

const POLL_INTERVAL_MS = 500;
const NO_QUERY_CLIENT_REASON =
  'No QueryClient is registered. Call registerQueryClient(queryClient) from the app.';

let watching = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let detachCacheListener: (() => void) | null = null;
let detachClientListener: (() => void) | null = null;
let attachedClient: QueryClientLike | null = null;
let lastSerializedSnapshot: string | null = null;

export function setReactQueryWatching(enabled: boolean): void {
  if (watching === enabled) {
    return;
  }

  watching = enabled;
  if (enabled) {
    startWatching();
    emitReactQuerySnapshot();
    return;
  }

  stopWatching();
}

export function emitReactQuerySnapshot(): void {
  const snapshot = createReactQuerySnapshot();
  const serialized = JSON.stringify({
    queries: snapshot.queries,
    reason: snapshot.reason,
  });
  if (serialized === lastSerializedSnapshot) {
    return;
  }
  lastSerializedSnapshot = serialized;

  try {
    DebuggerConnection.send({
      method: REACT_QUERY_CDP_QUERIES_UPDATED_METHOD,
      params: {
        snapshot,
        updatedAt: snapshot.updatedAt,
      },
    });
  } catch {
    // Query updates are advisory and should not break app runtime code.
  }
}

export function createReactQuerySnapshot(): ReactQuerySnapshot {
  const client = getQueryClient();
  if (!client) {
    return {
      queries: [],
      queryCount: 0,
      updatedAt: Date.now(),
      reason: NO_QUERY_CLIENT_REASON,
    };
  }

  const cache = getQueryCache(client);
  if (!cache) {
    return {
      queries: [],
      queryCount: 0,
      updatedAt: Date.now(),
      reason: 'The registered QueryClient does not expose getQueryCache().',
    };
  }

  const queries = getQueries(cache).map(createQuerySnapshot);
  return {
    queries,
    queryCount: queries.length,
    updatedAt: Date.now(),
  };
}

function startWatching(): void {
  detachClientListener =
    detachClientListener ??
    addQueryClientListener(() => {
      attachQueryCacheListener();
      emitReactQuerySnapshot();
    });

  attachQueryCacheListener();
  pollTimer =
    pollTimer ??
    setInterval(() => {
      attachQueryCacheListener();
      emitReactQuerySnapshot();
    }, POLL_INTERVAL_MS);
}

function stopWatching(): void {
  detachCacheListener?.();
  detachCacheListener = null;
  attachedClient = null;
  detachClientListener?.();
  detachClientListener = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastSerializedSnapshot = null;
}

function attachQueryCacheListener(): void {
  const client = getQueryClient();
  if (attachedClient === client) {
    return;
  }

  detachCacheListener?.();
  detachCacheListener = null;
  attachedClient = client;

  if (!client) {
    return;
  }

  const cache = getQueryCache(client);
  if (!cache || typeof cache.subscribe !== 'function') {
    return;
  }

  const subscription = cache.subscribe.call(cache, () => {
    emitReactQuerySnapshot();
  });

  if (typeof subscription === 'function') {
    detachCacheListener = subscription;
    return;
  }
  if (
    subscription &&
    typeof subscription === 'object' &&
    typeof (subscription as { unsubscribe?: unknown }).unsubscribe === 'function'
  ) {
    detachCacheListener = () => {
      (subscription as { unsubscribe: () => void }).unsubscribe();
    };
  }
}

function getQueries(cache: QueryCacheLike): unknown[] {
  if (typeof cache.getAll === 'function') {
    const value = cache.getAll.call(cache);
    return Array.isArray(value) ? value : [];
  }
  if (typeof cache.findAll === 'function') {
    const value = cache.findAll.call(cache);
    return Array.isArray(value) ? value : [];
  }
  return [];
}

function createQuerySnapshot(query: unknown): ReactQueryQuerySnapshot {
  const record = query && typeof query === 'object'
    ? (query as Record<string, unknown>)
    : {};
  const state = normalizeRecord(record.state);
  const queryKey = getQueryKey(record);
  const queryHash = getQueryHash(record, queryKey);

  return {
    queryHash,
    queryKey: sanitizeJson(queryKey),
    queryKeyLabel: formatQueryKey(queryKey),
    state: {
      status: toOptionalString(state.status),
      fetchStatus: toOptionalString(state.fetchStatus),
      dataUpdatedAt: toOptionalNumber(state.dataUpdatedAt),
      errorUpdatedAt: toOptionalNumber(state.errorUpdatedAt),
      isInvalidated: toOptionalBoolean(state.isInvalidated),
    },
    data: sanitizeJson(state.data),
    ...(state.error !== undefined ? { error: sanitizeJson(state.error) } : {}),
  };
}

function getQueryKey(record: Record<string, unknown>): unknown {
  if ('queryKey' in record) {
    return record.queryKey;
  }
  const options = normalizeRecord(record.options);
  return options.queryKey;
}

function getQueryHash(
  record: Record<string, unknown>,
  queryKey: unknown
): string {
  if (typeof record.queryHash === 'string' && record.queryHash.length > 0) {
    return record.queryHash;
  }
  return stableStringify(queryKey);
}

function formatQueryKey(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  try {
    const stringified = JSON.stringify(sanitizeJson(value));
    return typeof stringified === 'string' ? stringified : String(value);
  } catch {
    return String(value);
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
