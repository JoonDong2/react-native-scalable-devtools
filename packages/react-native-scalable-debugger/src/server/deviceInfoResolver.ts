import { execFile } from 'child_process';
import type {
  ConnectedAppDeviceInfo,
  ConnectedAppTarget,
} from '../types/connection';

interface HostDeviceInfo {
  id: string;
  name?: string;
  model?: string;
  osVersion?: string;
}

interface CachedHostDeviceInfo {
  expiresAt: number;
  androidDevices: readonly HostDeviceInfo[];
  iosDevices: readonly HostDeviceInfo[];
}

const HOST_DEVICE_INFO_TTL_MS = 2000;
const COMMAND_TIMEOUT_MS = 1000;
const UNKNOWN_DEVICE_ID = 'unknown';

let hostDeviceInfoCache: CachedHostDeviceInfo | null = null;

export async function enrichAppTargetsWithDeviceInfo(
  targets: readonly ConnectedAppTarget[]
): Promise<ConnectedAppTarget[]> {
  if (targets.every((target) => isKnownDeviceId(target.deviceInfo?.deviceId))) {
    return [...targets];
  }

  const hostDeviceInfo = await getHostDeviceInfo();

  return targets.map((target) => {
    if (isKnownDeviceId(target.deviceInfo?.deviceId)) {
      return target;
    }

    const deviceId = resolveHostDeviceId(target, hostDeviceInfo);
    if (!deviceId && !shouldIncludeUnknownDeviceId(target.deviceInfo)) {
      return target;
    }

    return {
      ...target,
      deviceInfo: {
        ...target.deviceInfo,
        deviceId: deviceId ?? UNKNOWN_DEVICE_ID,
      },
    };
  });
}

function shouldIncludeUnknownDeviceId(
  deviceInfo: ConnectedAppDeviceInfo | undefined
): boolean {
  return deviceInfo?.platform === 'android' || deviceInfo?.platform === 'ios';
}

function isKnownDeviceId(deviceId: string | undefined): boolean {
  return !!deviceId && !isPlaceholderDeviceId(deviceId);
}

function isPlaceholderDeviceId(deviceId: string): boolean {
  return deviceId.trim().toLowerCase() === UNKNOWN_DEVICE_ID;
}

function resolveHostDeviceId(
  target: ConnectedAppTarget,
  hostDeviceInfo: CachedHostDeviceInfo
): string | undefined {
  const platform = target.deviceInfo?.platform;
  if (platform === 'android') {
    return resolveFromHostDevices(target.deviceInfo, hostDeviceInfo.androidDevices);
  }

  if (platform === 'ios') {
    return resolveFromHostDevices(target.deviceInfo, hostDeviceInfo.iosDevices);
  }

  return undefined;
}

function resolveFromHostDevices(
  deviceInfo: ConnectedAppDeviceInfo | undefined,
  hostDevices: readonly HostDeviceInfo[]
): string | undefined {
  if (hostDevices.length === 0) {
    return undefined;
  }

  const matched = hostDevices.filter((device) =>
    hostDeviceMatches(device, deviceInfo)
  );
  if (matched.length === 1) {
    return matched[0].id;
  }

  return hostDevices.length === 1 ? hostDevices[0].id : undefined;
}

function hostDeviceMatches(
  hostDevice: HostDeviceInfo,
  deviceInfo: ConnectedAppDeviceInfo | undefined
): boolean {
  const expectedNames = [
    deviceInfo?.deviceName,
    deviceInfo?.model,
  ].map(normalizeComparableValue);
  const actualNames = [
    hostDevice.name,
    hostDevice.model,
  ].map(normalizeComparableValue);
  const expectedOsVersion = normalizeComparableValue(deviceInfo?.osVersion);
  const actualOsVersion = normalizeComparableValue(hostDevice.osVersion);

  return (
    expectedNames.some(
      (expected) => expected && actualNames.includes(expected)
    ) ||
    (!!expectedOsVersion && expectedOsVersion === actualOsVersion)
  );
}

async function getHostDeviceInfo(): Promise<CachedHostDeviceInfo> {
  const now = Date.now();
  if (hostDeviceInfoCache && hostDeviceInfoCache.expiresAt > now) {
    return hostDeviceInfoCache;
  }

  const [androidDevices, iosDevices] = await Promise.all([
    listAndroidDevices(),
    listIosDevices(),
  ]);

  hostDeviceInfoCache = {
    expiresAt: now + HOST_DEVICE_INFO_TTL_MS,
    androidDevices,
    iosDevices,
  };

  return hostDeviceInfoCache;
}

async function listAndroidDevices(): Promise<HostDeviceInfo[]> {
  const output = await execFileSafely('adb', ['devices', '-l']);
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('List of devices'))
    .map(parseAdbDeviceLine)
    .filter((device): device is HostDeviceInfo => device != null);
}

function parseAdbDeviceLine(line: string): HostDeviceInfo | null {
  const [id, state, ...details] = line.split(/\s+/);
  if (!id || state !== 'device') {
    return null;
  }

  const model = details
    .find((detail) => detail.startsWith('model:'))
    ?.slice('model:'.length);

  return {
    id,
    model,
  };
}

async function listIosDevices(): Promise<HostDeviceInfo[]> {
  const [simulators, physicalDevices] = await Promise.all([
    listBootedIosSimulators(),
    listPhysicalIosDevices(),
  ]);

  return dedupeHostDevices([...simulators, ...physicalDevices]);
}

async function listBootedIosSimulators(): Promise<HostDeviceInfo[]> {
  const output = await execFileSafely('xcrun', [
    'simctl',
    'list',
    '--json',
    'devices',
    'booted',
  ]);
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output) as {
      devices?: Record<string, Array<{
        name?: string;
        udid?: string;
        state?: string;
      }>>;
    };

    return Object.entries(parsed.devices ?? {})
      .filter(([runtime]) => runtime.includes('iOS'))
      .flatMap(([, devices]) => devices)
      .filter((device) => device.state === 'Booted' && !!device.udid)
      .map((device) => ({
        id: device.udid!,
        name: device.name,
      }));
  } catch {
    return [];
  }
}

async function listPhysicalIosDevices(): Promise<HostDeviceInfo[]> {
  const devicectlDevices = await listPhysicalIosDevicesFromDevicectl();
  if (devicectlDevices.length > 0) {
    return devicectlDevices;
  }

  return listPhysicalIosDevicesFromXctrace();
}

async function listPhysicalIosDevicesFromDevicectl(): Promise<HostDeviceInfo[]> {
  const output = await execFileSafely('xcrun', [
    'devicectl',
    'list',
    'devices',
    '--json-output',
    '-',
  ]);
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return getDevicectlDeviceRecords(parsed)
      .map(parseDevicectlDevice)
      .filter((device): device is HostDeviceInfo => device != null);
  } catch {
    return [];
  }
}

function getDevicectlDeviceRecords(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  const result = asRecord(root?.result);
  const devices = asArray(result?.devices) ?? asArray(root?.devices);
  return (devices ?? []).filter(isRecord);
}

function parseDevicectlDevice(
  device: Record<string, unknown>
): HostDeviceInfo | null {
  if (!isUsableDevicectlDevice(device)) {
    return null;
  }

  const deviceProperties = asRecord(device.deviceProperties);
  const hardwareProperties = asRecord(device.hardwareProperties);
  const id =
    getString(device.identifier) ??
    getString(device.udid) ??
    getString(device.deviceIdentifier) ??
    getString(hardwareProperties?.udid);

  if (!id) {
    return null;
  }

  return {
    id,
    name:
      getString(device.name) ??
      getString(deviceProperties?.name),
    model:
      getString(device.model) ??
      getString(hardwareProperties?.deviceType) ??
      getString(hardwareProperties?.productType),
    osVersion:
      getString(device.osVersion) ??
      getString(deviceProperties?.osVersionNumber) ??
      getString(deviceProperties?.operatingSystemVersion),
  };
}

function isUsableDevicectlDevice(device: Record<string, unknown>): boolean {
  const connectionProperties = asRecord(device.connectionProperties);
  const availability = asRecord(device.availability);
  const state =
    getString(device.state) ??
    getString(device.connectionState) ??
    getString(connectionProperties?.state) ??
    getString(availability?.state);

  return !state || !/(unavailable|disconnected|shutdown)/i.test(state);
}

async function listPhysicalIosDevicesFromXctrace(): Promise<HostDeviceInfo[]> {
  const output = await execFileSafely('xcrun', ['xctrace', 'list', 'devices']);
  if (!output) {
    return [];
  }

  const devices: HostDeviceInfo[] = [];
  let inPhysicalDeviceSection = false;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('==')) {
      inPhysicalDeviceSection = line === '== Devices ==';
      continue;
    }

    if (!inPhysicalDeviceSection) {
      continue;
    }

    const device = parseXctraceDeviceLine(line);
    if (device) {
      devices.push(device);
    }
  }

  return devices;
}

function parseXctraceDeviceLine(line: string): HostDeviceInfo | null {
  const match = line.match(/^(.+?)\s+\(([^()]*)\)\s+\(([A-Fa-f0-9-]{8,})\)$/);
  if (!match) {
    return null;
  }

  const [, name, osVersion, id] = match;
  if (!/(iphone|ipad|ipod|vision)/i.test(name)) {
    return null;
  }

  return {
    id,
    name,
    osVersion,
  };
}

function dedupeHostDevices(
  devices: readonly HostDeviceInfo[]
): HostDeviceInfo[] {
  const result = new Map<string, HostDeviceInfo>();
  for (const device of devices) {
    result.set(device.id, {
      ...result.get(device.id),
      ...device,
    });
  }
  return Array.from(result.values());
}

function normalizeComparableValue(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/_/g, ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function execFileSafely(
  command: string,
  args: readonly string[]
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: COMMAND_TIMEOUT_MS,
      },
      (error, stdout) => {
        resolve(error ? null : stdout);
      }
    );
  });
}
