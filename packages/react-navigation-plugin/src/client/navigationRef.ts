export interface NavigationRefLike {
  isReady?: unknown;
  getRootState?: unknown;
  getCurrentRoute?: unknown;
  addListener?: unknown;
  navigate?: unknown;
  goBack?: unknown;
  canGoBack?: unknown;
  dispatch?: unknown;
  resetRoot?: unknown;
}

let navigationRef: NavigationRefLike | null = null;
const listeners = new Set<() => void>();

export function registerNavigationRef(ref: NavigationRefLike): void {
  navigationRef = ref;
  notifyNavigationRefListeners();
}

export function clearNavigationRef(ref?: NavigationRefLike): void {
  if (!ref || navigationRef === ref) {
    navigationRef = null;
    notifyNavigationRefListeners();
  }
}

export function getNavigationRef(): NavigationRefLike | null {
  return navigationRef;
}

export function isNavigationReady(ref: NavigationRefLike): boolean {
  return typeof ref.isReady === 'function' ? ref.isReady() === true : true;
}

export function addNavigationRefListener(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyNavigationRefListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Keep ref registration independent from optional devtools listeners.
    }
  });
}
