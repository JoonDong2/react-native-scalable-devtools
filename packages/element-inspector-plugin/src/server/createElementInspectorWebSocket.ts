import type {
  PluginEndpointContext,
  WebSocketEndpointContribution,
} from '@react-native-scalable-devtools/cli/plugin';
import type { RawData, WebSocket, WebSocketServer } from 'ws';
import type { ElementInspectorController } from './ElementInspectorController';
import { stringifyJson } from '../shared/stringifyJson';

const WS = require('ws') as {
  Server: typeof WebSocketServer;
  OPEN: number;
};

interface WebSocketRequest {
  id?: string | number;
  type?: string;
  appId?: string;
}

interface WebSocketSubscription {
  unsubscribe: () => void;
}

export function createElementInspectorWebSocket(
  controller: ElementInspectorController
): WebSocketEndpointContribution['server'] {
  let endpointContext: PluginEndpointContext | null = null;
  let wss: WebSocketServer | null = null;

  return (_request, context) => {
    endpointContext = context;
    controller.attach(context);

    if (wss) {
      return wss;
    }

    wss = new WS.Server({
      noServer: true,
      perMessageDeflate: true,
      maxPayload: 0,
    });

    wss.on('connection', (socket: WebSocket) => {
      let subscription: WebSocketSubscription | null = null;

      socket.on('message', (message: RawData) => {
        void handleSocketMessage(
          socket,
          message,
          controller,
          () => endpointContext,
          (nextSubscription) => {
            subscription?.unsubscribe();
            subscription = nextSubscription;
          }
        );
      });

      socket.on('close', () => {
        subscription?.unsubscribe();
        subscription = null;
      });
    });

    return wss;
  };
}

async function handleSocketMessage(
  socket: WebSocket,
  message: RawData,
  controller: ElementInspectorController,
  getContext: () => PluginEndpointContext | null,
  setSubscription: (subscription: WebSocketSubscription | null) => void
): Promise<void> {
  const request = parseRequest(message);
  if (!request || typeof request.type !== 'string') {
    sendJson(socket, {
      type: 'error',
      error: 'invalid_message',
      message: 'Expected a JSON message with a string "type" field.',
    });
    return;
  }

  const context = getContext();
  if (!context) {
    sendJson(socket, {
      id: request.id,
      type: 'error',
      error: 'endpoint_not_ready',
      message: 'Element inspector endpoint is not ready.',
    });
    return;
  }

  if (request.type === 'subscribe') {
    const unsubscribe = controller.subscribe((result) => {
      if (
        request.appId &&
        result.device.appId !== request.appId
      ) {
        return;
      }

      sendJson(socket, {
        type: 'snapshot',
        ...result,
      });
    });
    setSubscription({ unsubscribe });
    sendJson(socket, {
      id: request.id,
      type: 'subscribed',
      ok: true,
      appId: request.appId ?? null,
    });
    return;
  }

  if (request.type === 'unsubscribe') {
    setSubscription(null);
    sendJson(socket, {
      id: request.id,
      type: 'unsubscribed',
      ok: true,
    });
    return;
  }

  if (request.type === 'getTree') {
    const result = await controller.requestSnapshot(context, {
      appId: request.appId,
    });

    if (result.ok) {
      sendJson(socket, {
        id: request.id,
        type: 'snapshot',
        ...stripStatusCode(result),
      });
      return;
    }

    sendJson(socket, {
      id: request.id,
      type: 'error',
      ...stripStatusCode(result),
    });
    return;
  }

  sendJson(socket, {
    id: request.id,
    type: 'error',
    error: 'unknown_type',
    message: `Unknown element inspector message type "${request.type}".`,
  });
}

function parseRequest(message: RawData): WebSocketRequest | null {
  try {
    const parsed = JSON.parse(message.toString());
    return parsed && typeof parsed === 'object'
      ? (parsed as WebSocketRequest)
      : null;
  } catch {
    return null;
  }
}

function stripStatusCode<T extends { statusCode: number }>(
  value: T
): Omit<T, 'statusCode'> {
  const { statusCode: _statusCode, ...rest } = value;
  return rest;
}

function sendJson(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WS.OPEN) {
    return;
  }
  socket.send(stringifyJson(message));
}
