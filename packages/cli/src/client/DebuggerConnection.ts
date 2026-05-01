import { JS_APP_URL } from '../shared/constants';
import jsonParseSafely from '../shared/jsonParseSafely';
import DevMiddlewareConnection from './DevMiddlewareConnection';
import { getHost } from './utils/host';
import { Platform } from 'react-native';
import type { CDPMessage } from '../types/cdp';
import type { MessageListener } from '../types/connection';

interface ExtendedWebSocket extends WebSocket {
  _socketId?: number;
}

let ws: ExtendedWebSocket | null = null;
let connectionIntervalId: ReturnType<typeof setInterval> | null = null;
let isConnecting = false;

const INTERVAL_MS = 1500;

let socketId: number | null = null;

const listeners = new Set<MessageListener>();
let sendQueue: (CDPMessage | string)[] = [];

const id = Math.random().toString(36).substring(2, 15);
const { host, port } = getHost();

const clearWS = (): void => {
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
    ws = null;
  }
};

const stopReconnectTimer = (): void => {
  if (connectionIntervalId) {
    clearInterval(connectionIntervalId);
    connectionIntervalId = null;
  }
};

const send = (message: CDPMessage | string): void => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const stringifiedMessage =
      typeof message === 'string' ? message : JSON.stringify(message);
    ws.send(stringifiedMessage);
  } else {
    sendQueue.push(message);
  }
};

const connect = (): void => {
  if ((ws && ws.readyState === WebSocket.OPEN) || isConnecting) {
    return;
  }

  isConnecting = true;
  DevMiddlewareConnection.setId(id);

  ws = new WebSocket(
    `ws://${host}:${port}${JS_APP_URL}?${createConnectionQuery()}`
  ) as ExtendedWebSocket;

  ws.onmessage = (event: MessageEvent): void => {
    if (event.data === 'ping') {
      ws!.send('pong');
      return;
    }

    const parsedData = jsonParseSafely<CDPMessage>(event.data);
    if (parsedData) {
      listeners.forEach((listener) => listener(parsedData));
    }
  };

  ws.onopen = (): void => {
    socketId = ws!._socketId ?? null;
    isConnecting = false;
    stopReconnectTimer();

    const oldQueue = sendQueue;
    sendQueue = [];
    oldQueue.forEach(send);
  };

  ws.onclose = (): void => {
    isConnecting = false;
    clearWS();
    startReconnectProcess();
  };

  ws.onerror = (): void => {
    isConnecting = false;
  };
};

function createConnectionQuery(): string {
  return createQueryString({
    id,
    ...getRuntimeDeviceInfo(),
  });
}

function getRuntimeDeviceInfo(): Record<string, string | undefined> {
  const constants = (Platform as unknown as {
    constants?: Record<string, unknown>;
  }).constants;
  const platform = Platform.OS;
  return {
    platform,
    os: firstString(constants, ['systemName']) ?? platform,
    osVersion:
      firstString(constants, ['osVersion', 'Release']) ??
      toStringValue(Platform.Version),
    deviceName: firstString(constants, [
      'deviceName',
      'DeviceName',
      'name',
    ]),
    model: firstString(constants, ['model', 'Model']),
    manufacturer: firstString(constants, ['manufacturer', 'Manufacturer']),
    brand: firstString(constants, ['brand', 'Brand']),
    deviceId: getRuntimeDeviceId(constants),
    isEmulator: toStringValue(firstDefined(constants, ['isEmulator', 'IsEmulator'])),
    reactNativeVersion: getReactNativeVersion(constants),
  };
}

function createQueryString(
  params: Record<string, string | undefined>
): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`
    )
    .join('&');
}

function firstString(
  object: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined {
  const value = firstDefined(object, keys);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstDefined(
  object: Record<string, unknown> | undefined,
  keys: readonly string[]
): unknown {
  if (!object) {
    return undefined;
  }
  for (const key of keys) {
    const value = object[key];
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function getRuntimeDeviceId(
  constants: Record<string, unknown> | undefined
): string | undefined {
  const value = firstString(constants, [
    'deviceId',
    'DeviceId',
    'serial',
    'Serial',
  ]);
  return isPlaceholderDeviceId(value) ? undefined : value;
}

function isPlaceholderDeviceId(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'unknown';
}

function getReactNativeVersion(
  constants: Record<string, unknown> | undefined
): string | undefined {
  const version = firstDefined(constants, ['reactNativeVersion']);
  if (!version || typeof version !== 'object') {
    return undefined;
  }

  const record = version as Record<string, unknown>;
  const major = toStringValue(record.major);
  const minor = toStringValue(record.minor);
  const patch = toStringValue(record.patch);
  if (!major || !minor || !patch) {
    return undefined;
  }
  return `${major}.${minor}.${patch}`;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

const startReconnectProcess = (): void => {
  stopReconnectTimer();
  connect();
  connectionIntervalId = setInterval(() => {
    connect();
  }, INTERVAL_MS);
};

export default {
  connect: (): void => {
    startReconnectProcess();
  },
  send,
  addEventListener: (listener: MessageListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSocketId: (): number | null => {
    return socketId;
  },
};
