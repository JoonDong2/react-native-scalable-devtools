import type { ReactQueryResult } from '../shared/protocol';
import { createReactQuerySnapshot } from './queryWatcher';

interface ActionContext {
  requestId: string;
  requestedAt: number;
}

export async function performReactQueryAction(
  context: ActionContext,
  action: string
): Promise<ReactQueryResult> {
  try {
    switch (action) {
      case 'getQueries':
        return getQueries(context);
      default:
        return createResult(context, action, 'unsupported', {
          reason: `Unsupported React Query action: ${action}`,
        });
    }
  } catch (error) {
    return createResult(context, action, 'error', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function getQueries(context: ActionContext): ReactQueryResult {
  const snapshot = createReactQuerySnapshot();
  return createResult(
    context,
    'getQueries',
    snapshot.reason ? 'unsupported' : 'ok',
    {
      value: snapshot,
      reason: snapshot.reason,
    }
  );
}

function createResult(
  context: ActionContext,
  action: string,
  status: ReactQueryResult['status'],
  extras: Partial<ReactQueryResult> = {}
): ReactQueryResult {
  return {
    requestId: context.requestId,
    requestedAt: context.requestedAt,
    completedAt: Date.now(),
    action: action as ReactQueryResult['action'],
    status,
    ...extras,
  };
}
