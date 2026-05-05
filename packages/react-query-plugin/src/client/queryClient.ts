export interface QueryCacheLike {
  getAll?: unknown;
  findAll?: unknown;
  subscribe?: unknown;
}

export interface QueryClientLike {
  getQueryCache?: unknown;
}

let queryClient: QueryClientLike | null = null;
const listeners = new Set<() => void>();

export function registerQueryClient(client: QueryClientLike): void {
  queryClient = client;
  notifyQueryClientListeners();
}

export function clearQueryClient(client?: QueryClientLike): void {
  if (!client || queryClient === client) {
    queryClient = null;
    notifyQueryClientListeners();
  }
}

export function getQueryClient(): QueryClientLike | null {
  return queryClient;
}

export function getQueryCache(client: QueryClientLike): QueryCacheLike | null {
  return typeof client.getQueryCache === 'function'
    ? normalizeQueryCache(client.getQueryCache.call(client))
    : null;
}

export function addQueryClientListener(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function normalizeQueryCache(value: unknown): QueryCacheLike | null {
  return value && typeof value === 'object' ? (value as QueryCacheLike) : null;
}

function notifyQueryClientListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Keep QueryClient registration independent from optional devtools listeners.
    }
  });
}
