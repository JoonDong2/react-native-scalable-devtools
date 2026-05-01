import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  ConnectedAppDeviceInfo,
  ConnectedAppTarget,
} from '../types/connection';

interface HostDeviceInfo {
  id: string;
  brand?: string;
  manufacturer?: string;
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

  const osVersionMatched = hostDevices.filter((device) =>
    hostDeviceOsVersionMatches(device, deviceInfo)
  );
  if (osVersionMatched.length === 1) {
    return osVersionMatched[0].id;
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
    deviceInfo?.brand,
    deviceInfo?.manufacturer,
  ].map(normalizeComparableValue);
  const actualNames = [
    hostDevice.name,
    hostDevice.model,
    hostDevice.brand,
    hostDevice.manufacturer,
  ].map(normalizeComparableValue);
  const expectedOsVersion = normalizeComparableValue(deviceInfo?.osVersion);
  const actualOsVersion = normalizeComparableValue(hostDevice.osVersion);

  return (
    expectedNames.some(
      (expected) =>
        expected &&
        actualNames.some((actual) => comparableValuesMatch(expected, actual))
    ) ||
    comparableVersionsMatch(expectedOsVersion, actualOsVersion)
  );
}

function hostDeviceOsVersionMatches(
  hostDevice: HostDeviceInfo,
  deviceInfo: ConnectedAppDeviceInfo | undefined
): boolean {
  return comparableVersionsMatch(
    normalizeComparableValue(deviceInfo?.osVersion),
    normalizeComparableValue(hostDevice.osVersion)
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

  const detailMap = Object.fromEntries(
    details
      .map((detail) => detail.split(':'))
      .filter(([key, value]) => key && value)
  );

  return {
    id,
    brand: detailMap.brand,
    manufacturer: detailMap.manufacturer,
    model: detailMap.model,
    name: detailMap.device,
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
    return listBootedIosSimulatorsFromDevicePlists();
  }

  try {
    const parsed = JSON.parse(output) as {
      devices?: Record<string, Array<{
        deviceTypeIdentifier?: string;
        name?: string;
        runtime?: string;
        udid?: string;
        state?: string;
      }>>;
    };

    const simulators = Object.entries(parsed.devices ?? {})
      .filter(([runtime]) => runtime.includes('iOS'))
      .flatMap(([runtime, devices]) =>
        devices.map((device) => ({
          ...device,
          runtime,
        }))
      )
      .filter((device) => device.state === 'Booted' && !!device.udid)
      .map((device) => ({
        id: device.udid!,
        model: formatCoreSimulatorDeviceType(device.deviceTypeIdentifier),
        name: device.name,
        osVersion: formatCoreSimulatorRuntime(device.runtime),
      }));

    return simulators.length > 0
      ? simulators
      : listBootedIosSimulatorsFromDevicePlists();
  } catch {
    return listBootedIosSimulatorsFromDevicePlists();
  }
}

async function listBootedIosSimulatorsFromDevicePlists(): Promise<HostDeviceInfo[]> {
  const devicesRoot = path.join(
    os.homedir(),
    'Library',
    'Developer',
    'CoreSimulator',
    'Devices'
  );
  let deviceIds: string[] = [];
  try {
    deviceIds = fs.readdirSync(devicesRoot);
  } catch {
    return [];
  }

  const devices = await Promise.all(
    deviceIds.map(async (deviceId) => {
      const plistPath = path.join(devicesRoot, deviceId, 'device.plist');
      const output = await execFileSafely('/usr/libexec/PlistBuddy', [
        '-c',
        'Print',
        plistPath,
      ]);
      return output ? parseCoreSimulatorDevicePlist(output) : null;
    })
  );

  return devices.filter((device): device is HostDeviceInfo => device != null);
}

function parseCoreSimulatorDevicePlist(output: string): HostDeviceInfo | null {
  const record: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^([^=]+?)\s=\s(.+)$/);
    if (match) {
      record[match[1].trim()] = match[2].trim();
    }
  }

  if (
    record.isDeleted === 'true' ||
    record.state !== '3' ||
    !record.runtime?.includes('iOS') ||
    !record.UDID
  ) {
    return null;
  }

  return {
    id: record.UDID,
    model: formatCoreSimulatorDeviceType(record.deviceType),
    name: record.name,
    osVersion: formatCoreSimulatorRuntime(record.runtime),
  };
}

function formatCoreSimulatorDeviceType(
  deviceType: string | undefined
): string | undefined {
  return deviceType
    ?.replace(/^com\.apple\.CoreSimulator\.SimDeviceType\./, '')
    .replace(/-/g, ' ');
}

function formatCoreSimulatorRuntime(
  runtime: string | undefined
): string | undefined {
  return runtime
    ?.replace(/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/, '')
    .replace(/-/g, '.');
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

function comparableValuesMatch(
  expected: string | undefined,
  actual: string | undefined
): boolean {
  if (!expected || !actual) {
    return false;
  }
  return expected === actual || expected.includes(actual) || actual.includes(expected);
}

function comparableVersionsMatch(
  expected: string | undefined,
  actual: string | undefined
): boolean {
  if (!expected || !actual) {
    return false;
  }
  return (
    expected === actual ||
    expected.startsWith(`${actual}.`) ||
    actual.startsWith(`${expected}.`)
  );
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
  const candidates = getCommandCandidates(command);

  return new Promise((resolve) => {
    const tryCandidate = (index: number): void => {
      const candidate = candidates[index];
      if (!candidate) {
        resolve(null);
        return;
      }

      execFile(
        candidate,
        [...args],
        (error, stdout) => {
          if (!error && stdout) {
            resolve(stdout);
            return;
          }
          tryCandidate(index + 1);
        }
      );
    };

    tryCandidate(0);
  });
}

function getCommandCandidates(command: string): string[] {
  if (command === 'adb') {
    return uniqueStrings([
      process.env.ADB,
      getAndroidSdkCommand('adb'),
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
      command,
    ]);
  }

  if (command === 'xcrun') {
    return uniqueStrings([
      process.env.XCRUN,
      '/usr/bin/xcrun',
      command,
    ]);
  }

  return [command];
}

function getAndroidSdkCommand(command: string): string | undefined {
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  return sdkRoot ? path.join(sdkRoot, 'platform-tools', command) : undefined;
}

function uniqueStrings(
  values: readonly (string | undefined)[]
): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    )
  );
}
