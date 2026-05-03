export interface ReactFiberLike {
  key?: string | null;
  child?: ReactFiberLike | null;
  sibling?: ReactFiberLike | null;
  alternate?: ReactFiberLike | null;
  return?: ReactFiberLike | null;
  elementType?: unknown;
  type?: unknown;
  tag?: number;
  memoizedProps?: unknown;
  pendingProps?: unknown;
  stateNode?: unknown;
  _debugSource?: {
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export interface ReactFiberRootLike {
  current?: ReactFiberLike | null;
}

interface ReactDevToolsHookLike {
  renderers?: {
    keys?: () => Iterable<number>;
    forEach?: (callback: (_value: unknown, key: number) => void) => void;
  };
  getFiberRoots?: (
    rendererId: number
  ) => Set<ReactFiberRootLike> | Iterable<ReactFiberRootLike>;
}

export function getReactDevToolsFiberRoots(): ReactFiberRootLike[] {
  const hook = (globalThis as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: ReactDevToolsHookLike;
  }).__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (!hook || typeof hook.getFiberRoots !== 'function') {
    return [];
  }

  const rendererIds = getRendererIds(hook);
  const roots: ReactFiberRootLike[] = [];

  for (const rendererId of rendererIds) {
    const rendererRoots = hook.getFiberRoots(rendererId);
    if (!rendererRoots) {
      continue;
    }

    for (const root of rendererRoots) {
      roots.push(root);
    }
  }

  return roots;
}

function getRendererIds(hook: ReactDevToolsHookLike): number[] {
  const renderers = hook.renderers;
  if (!renderers) {
    return [];
  }

  if (typeof renderers.keys === 'function') {
    return Array.from(renderers.keys()).filter(isFiniteNumber);
  }

  const ids: number[] = [];
  if (typeof renderers.forEach === 'function') {
    renderers.forEach((_value, key) => {
      if (isFiniteNumber(key)) {
        ids.push(key);
      }
    });
  }
  return ids;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
