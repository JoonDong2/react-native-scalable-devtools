import '@react-native-scalable-devtools/element-inspector-plugin/client';
import { installAgentActionsRequestHandler } from './requestHandler';

installAgentActionsRequestHandler();

export {
  clearNavigationRef,
  getNavigationRef,
  registerNavigationRef,
  type NavigationRefLike,
} from './navigationRef';
export { installAgentActionsRequestHandler };
