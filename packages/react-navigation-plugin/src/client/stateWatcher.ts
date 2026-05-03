import { DebuggerConnection } from '@react-native-scalable-devtools/cli/client';
import {
  REACT_NAVIGATION_CDP_STATE_UPDATED_METHOD,
  type ReactNavigationStateSnapshot,
} from '../shared/protocol';
import {
  addNavigationRefListener,
  getNavigationRef,
  isNavigationReady,
  type NavigationRefLike,
} from './navigationRef';
import { sanitizeJson } from './sanitizeJson';

const POLL_INTERVAL_MS = 500;
const NO_NAVIGATION_REF_REASON =
  'No navigation ref is registered. Call registerNavigationRef(navigationRef) from the app.';

let watching = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let detachNavigationListener: (() => void) | null = null;
let detachRefListener: (() => void) | null = null;
let attachedRef: NavigationRefLike | null = null;
let lastSerializedSnapshot: string | null = null;

export function setReactNavigationStateWatching(enabled: boolean): void {
  if (watching === enabled) {
    return;
  }

  watching = enabled;
  if (enabled) {
    startWatching();
    emitNavigationStateSnapshot();
    return;
  }

  stopWatching();
}

export function emitNavigationStateSnapshot(): void {
  const snapshot = createNavigationStateSnapshot();
  const serialized = JSON.stringify({
    isReady: snapshot.isReady,
    state: snapshot.state,
    currentRoute: snapshot.currentRoute,
    reason: snapshot.reason,
  });
  if (serialized === lastSerializedSnapshot) {
    return;
  }
  lastSerializedSnapshot = serialized;

  try {
    DebuggerConnection.send({
      method: REACT_NAVIGATION_CDP_STATE_UPDATED_METHOD,
      params: {
        state: snapshot,
        updatedAt: snapshot.updatedAt,
      },
    });
  } catch {
    // Navigation updates are advisory and should not break app runtime code.
  }
}

export function createNavigationStateSnapshot(): ReactNavigationStateSnapshot {
  const ref = getNavigationRef();
  if (!ref) {
    return {
      isReady: false,
      state: null,
      currentRoute: null,
      updatedAt: Date.now(),
      reason: NO_NAVIGATION_REF_REASON,
    };
  }

  return {
    isReady: isNavigationReady(ref),
    state: sanitizeJson(callRefMethod(ref.getRootState, ref)),
    currentRoute: sanitizeJson(callRefMethod(ref.getCurrentRoute, ref)),
    updatedAt: Date.now(),
  };
}

function startWatching(): void {
  detachRefListener =
    detachRefListener ??
    addNavigationRefListener(() => {
      attachNavigationListener();
      emitNavigationStateSnapshot();
    });

  attachNavigationListener();
  pollTimer =
    pollTimer ??
    setInterval(() => {
      attachNavigationListener();
      emitNavigationStateSnapshot();
    }, POLL_INTERVAL_MS);
}

function stopWatching(): void {
  detachNavigationListener?.();
  detachNavigationListener = null;
  attachedRef = null;
  detachRefListener?.();
  detachRefListener = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastSerializedSnapshot = null;
}

function attachNavigationListener(): void {
  const ref = getNavigationRef();
  if (attachedRef === ref) {
    return;
  }

  detachNavigationListener?.();
  detachNavigationListener = null;
  attachedRef = ref;

  if (!ref || typeof ref.addListener !== 'function') {
    return;
  }

  const addListener = ref.addListener as (
    event: string,
    listener: () => void
  ) => (() => void) | { remove?: () => void } | void;
  const subscription = addListener('state', () => {
    emitNavigationStateSnapshot();
  });

  if (typeof subscription === 'function') {
    detachNavigationListener = subscription;
    return;
  }
  if (subscription && typeof subscription.remove === 'function') {
    detachNavigationListener = () => {
      subscription.remove?.();
    };
  }
}

function callRefMethod(method: unknown, ref: NavigationRefLike): unknown {
  return typeof method === 'function' ? method.call(ref) : undefined;
}
