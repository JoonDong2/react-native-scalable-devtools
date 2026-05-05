import { installReactQueryRequestHandler } from './requestHandler';

installReactQueryRequestHandler();

export {
  clearQueryClient,
  getQueryClient,
  registerQueryClient,
  type QueryCacheLike,
  type QueryClientLike,
} from './queryClient';
export { installReactQueryRequestHandler };
