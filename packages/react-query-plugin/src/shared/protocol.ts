export const REACT_QUERY_ENDPOINT = '/react-query';
export const REACT_QUERY_QUERIES_ENDPOINT = '/react-query/queries';

export const REACT_QUERY_PERFORM_METHOD = 'ReactQuery.perform';
export const REACT_QUERY_RESULT_METHOD = 'ReactQuery.result';

export const REACT_QUERY_CDP_DOMAIN = 'ReactQuery';
export const REACT_QUERY_CDP_ENABLE_METHOD = 'ReactQuery.enable';
export const REACT_QUERY_CDP_DISABLE_METHOD = 'ReactQuery.disable';
export const REACT_QUERY_CDP_GET_QUERIES_METHOD = 'ReactQuery.getQueries';
export const REACT_QUERY_CDP_QUERIES_UPDATED_METHOD =
  'ReactQuery.queriesUpdated';

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

export type ReactQueryActionName = 'getQueries';

export type ReactQueryStatus = 'ok' | 'unsupported' | 'error';

export interface ReactQueryPerformParams extends Record<string, unknown> {
  requestId: string;
  requestedAt: number;
  action: ReactQueryActionName;
}

export interface ReactQueryResult extends Record<string, unknown> {
  requestId: string;
  requestedAt: number;
  completedAt: number;
  action: ReactQueryActionName;
  status: ReactQueryStatus;
  reason?: string;
  value?: ReactQuerySnapshot;
}

export interface ReactQuerySnapshot extends Record<string, unknown> {
  queries: ReactQueryQuerySnapshot[];
  queryCount: number;
  updatedAt: number;
  reason?: string;
}

export interface ReactQueryQuerySnapshot extends Record<string, unknown> {
  queryHash: string;
  queryKey: JSONValue;
  queryKeyLabel: string;
  state: {
    status?: string;
    fetchStatus?: string;
    dataUpdatedAt?: number;
    errorUpdatedAt?: number;
    isInvalidated?: boolean;
  };
  data: JSONValue;
  error?: JSONValue;
}

export interface ReactQuerySuccessResponse {
  ok: true;
  device: ReactQueryDevice;
  result: ReactQueryResult;
}

export interface ReactQueryErrorResponse {
  ok: false;
  error: string;
  message: string;
  devices?: ReactQueryDevice[];
}

export interface ReactQueryDevice {
  appId: string;
  name: string;
  connected: boolean;
  connectedAt: number;
  hasDebugger: boolean;
}

export type ReactQueryResponse =
  | ReactQuerySuccessResponse
  | ReactQueryErrorResponse;
