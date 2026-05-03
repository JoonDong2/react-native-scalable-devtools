import type {
  JSONValue,
  ReactNavigationCommand,
  ReactNavigationResult,
} from '../shared/protocol';
import {
  getNavigationRef,
  isNavigationReady,
  type NavigationRefLike,
} from './navigationRef';
import { sanitizeJson } from './sanitizeJson';

interface ActionContext {
  requestId: string;
  requestedAt: number;
}

export async function performReactNavigationAction(
  context: ActionContext,
  action: string,
  params: {
    navigation?: ReactNavigationCommand;
  }
): Promise<ReactNavigationResult> {
  try {
    switch (action) {
      case 'getNavigationState':
        return getNavigationState(context);
      case 'navigate':
        return navigate(context, params.navigation);
      case 'goBack':
        return goBack(context);
      default:
        return createResult(context, action, 'unsupported', {
          reason: `Unsupported React Navigation action: ${action}`,
        });
    }
  } catch (error) {
    return createResult(context, action, 'error', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function getNavigationState(context: ActionContext): ReactNavigationResult {
  const ref = getNavigationRef();
  if (!ref) {
    return createResult(context, 'getNavigationState', 'unsupported', {
      reason:
        'No navigation ref is registered. Call registerNavigationRef(navigationRef) from the app.',
    });
  }

  return createResult(context, 'getNavigationState', 'ok', {
    value: {
      isReady: isNavigationReady(ref),
      state: sanitizeJson(callRefMethod(ref.getRootState, ref)),
      currentRoute: sanitizeJson(callRefMethod(ref.getCurrentRoute, ref)),
    },
  });
}

function navigate(
  context: ActionContext,
  command: ReactNavigationCommand | undefined
): ReactNavigationResult {
  const ref = getReadyNavigationRef(context, 'navigate');
  if ('status' in ref) {
    return ref;
  }

  if (!command || typeof command.name !== 'string' || command.name.length === 0) {
    return createResult(context, 'navigate', 'error', {
      reason: 'navigation.name must be a non-empty string.',
    });
  }
  if (typeof ref.navigate !== 'function') {
    return createResult(context, 'navigate', 'unsupported', {
      reason: 'The registered navigation ref does not expose navigate(...).',
    });
  }

  const navigateRef = ref.navigate;
  if (command.key || command.path || command.merge !== undefined) {
    navigateRef.call(ref, {
      name: command.name,
      params: command.params,
      key: command.key,
      path: command.path,
      merge: command.merge,
    });
  } else if (command.params !== undefined) {
    navigateRef.call(ref, command.name, command.params);
  } else {
    navigateRef.call(ref, command.name);
  }

  return createResult(context, 'navigate', 'ok', {
    value: getNavigationValue(ref),
  });
}

function goBack(context: ActionContext): ReactNavigationResult {
  const ref = getReadyNavigationRef(context, 'goBack');
  if ('status' in ref) {
    return ref;
  }
  if (typeof ref.goBack !== 'function') {
    return createResult(context, 'goBack', 'unsupported', {
      reason: 'The registered navigation ref does not expose goBack().',
    });
  }
  if (typeof ref.canGoBack === 'function' && !ref.canGoBack.call(ref)) {
    return createResult(context, 'goBack', 'unsupported', {
      reason: 'The navigation ref reports that it cannot go back.',
    });
  }

  ref.goBack.call(ref);
  return createResult(context, 'goBack', 'ok', {
    value: getNavigationValue(ref),
  });
}

function getReadyNavigationRef(
  context: ActionContext,
  action: 'navigate' | 'goBack'
): NavigationRefLike | ReactNavigationResult {
  const ref = getNavigationRef();
  if (!ref) {
    return createResult(context, action, 'unsupported', {
      reason:
        'No navigation ref is registered. Call registerNavigationRef(navigationRef) from the app.',
    });
  }
  if (!isNavigationReady(ref)) {
    return createResult(context, action, 'unsupported', {
      reason: 'The registered navigation ref is not ready yet.',
    });
  }
  return ref;
}

function getNavigationValue(ref: NavigationRefLike): JSONValue {
  return {
    state: sanitizeJson(callRefMethod(ref.getRootState, ref)),
    currentRoute: sanitizeJson(callRefMethod(ref.getCurrentRoute, ref)),
  };
}

function callRefMethod(method: unknown, ref: NavigationRefLike): unknown {
  return typeof method === 'function' ? method.call(ref) : undefined;
}

function createResult(
  context: ActionContext,
  action: string,
  status: ReactNavigationResult['status'],
  extras: Partial<ReactNavigationResult> = {}
): ReactNavigationResult {
  return {
    requestId: context.requestId,
    requestedAt: context.requestedAt,
    completedAt: Date.now(),
    action: action as ReactNavigationResult['action'],
    status,
    ...extras,
  };
}
