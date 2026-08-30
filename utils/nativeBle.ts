/**
 * Native BLE helpers for Capacitor Android/iOS via @capacitor-community/bluetooth-le.
 * Tuned for ESC/POS receipt printers and Fun Print pocket printers (C9 / MX06 / MXW01).
 * Dialect is chosen from GATT UUIDs, never from the Bluetooth advertised name.
 */

import { Capacitor } from '@capacitor/core';
import {
  BleClient,
  ConnectionPriority,
  dataViewToNumbers,
  numbersToDataView,
  type BleDevice,
  type BleService,
} from '@capacitor-community/bluetooth-le';
import {
  detectFunPrintFromServices,
  FUN_PRINT_SERVICE_UUIDS,
  isFunPrintDialect,
  type BlePrintDialect,
} from './funPrintProtocol';

/**
 * Services commonly used by BLE thermal printers.
 * Used as optionalServices + post-connect discovery — NOT as a scan filter
 * (mini printers often omit service UUIDs from advertisements).
 */
export const NATIVE_PRINTER_SERVICE_UUIDS = [
  ...FUN_PRINT_SERVICE_UUIDS, // Fun Print pocket printers (C9 / MX06 / MXW01)
  '000018f0-0000-1000-8000-00805f9b34fb', // ESC/POS
  '0000ff00-0000-1000-8000-00805f9b34fb', // common Chinese modules
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / JDY style
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  '0000ff10-0000-1000-8000-00805f9b34fb',
  'e7810a71-73d3-4920-8c74-028eefded309', // some POS dongles
  '00001101-0000-1000-8000-00805f9b34fb', // serial port profile over GATT (rare)
  '0000fff0-0000-1000-8000-00805f9b34fb',
];

const KNOWN_WRITE_CHAR_UUIDS = [
  '0000ae01-0000-1000-8000-00805f9b34fb', // Fun Print control
  '0000ae03-0000-1000-8000-00805f9b34fb', // Fun Print MXW01 data
  '0000ae10-0000-1000-8000-00805f9b34fb',
  '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // NUS RX (central → peripheral)
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ff01-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000af01-0000-1000-8000-00805f9b34fb',
  '0000ffe2-0000-1000-8000-00805f9b34fb',
];

/** Skip these when hunting for a generic write characteristic. */
const SKIP_SERVICE_UUIDS = new Set(
  [
    '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
    '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
    '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
    '0000180f-0000-1000-8000-00805f9b34fb', // Battery
    '0000180d-0000-1000-8000-00805f9b34fb', // Heart Rate
  ].map((u) => u.replace(/-/g, '').toLowerCase())
);

export interface NativeWriteChannel {
  deviceId: string;
  deviceName: string;
  serviceUuid: string;
  characteristicUuid: string;
  writeWithoutResponse: boolean;
  /** Preferred write chunk size (payload bytes). */
  chunkSize: number;
  dialect: BlePrintDialect;
  controlCharUuid: string;
  dataCharUuid?: string;
  notifyCharUuid?: string;
}

let initPromise: Promise<void> | null = null;

export const isNativeBlePlatform = (): boolean => Capacitor.isNativePlatform();

export const ensureNativeBleInitialized = async (): Promise<void> => {
  if (!isNativeBlePlatform()) {
    throw new Error('Native BLE is only available inside the Capacitor app.');
  }
  if (!initPromise) {
    initPromise = (async () => {
      // neverForLocation matches AndroidManifest usesPermissionFlags on BLUETOOTH_SCAN
      await BleClient.initialize({ androidNeverForLocation: true });
      try {
        await BleClient.setDisplayStrings({
          scanning: 'Looking for printers…',
          cancel: 'Cancel',
          availableDevices: 'Bluetooth printers',
          noDeviceFound: 'No BLE printer found. Power on the mini printer and try again.',
        });
      } catch {
        // optional API
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const uuidKey = (u: string) => u.replace(/-/g, '').toLowerCase();
const uuidEq = (a: string, b: string) => uuidKey(a) === uuidKey(b);

const isWritable = (props: { write?: boolean; writeWithoutResponse?: boolean } | undefined): boolean =>
  !!(props?.write || props?.writeWithoutResponse);

const isUserCancel = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel|canceled|cancelled|aborted/i.test(message);
};

/** Ensure adapter is on; prompt the user on Android when possible. */
export const nativeEnsureBluetoothOn = async (): Promise<void> => {
  await ensureNativeBleInitialized();
  let enabled = false;
  try {
    enabled = await BleClient.isEnabled();
  } catch {
    enabled = false;
  }
  if (enabled) return;

  try {
    // Android 12+ shows a system enable dialog when possible
    await BleClient.requestEnable();
  } catch {
    try {
      await BleClient.enable();
    } catch {
      // fall through
    }
  }

  enabled = await BleClient.isEnabled().catch(() => false);
  if (!enabled) {
    throw new Error('Bluetooth is turned off. Enable Bluetooth and try again.');
  }
};

const pickWriteChannel = (
  deviceId: string,
  deviceName: string,
  services: BleService[],
  chunkSize: number
): NativeWriteChannel => {
  const build = (
    serviceUuid: string,
    characteristicUuid: string,
    writeWithoutResponse: boolean,
    extra?: Partial<Pick<NativeWriteChannel, 'dialect' | 'controlCharUuid' | 'dataCharUuid' | 'notifyCharUuid'>>
  ): NativeWriteChannel => ({
    deviceId,
    deviceName,
    serviceUuid,
    characteristicUuid,
    writeWithoutResponse,
    chunkSize,
    dialect: extra?.dialect ?? 'escpos',
    controlCharUuid: extra?.controlCharUuid ?? characteristicUuid,
    dataCharUuid: extra?.dataCharUuid,
    notifyCharUuid: extra?.notifyCharUuid,
  });

  const fun = detectFunPrintFromServices(services);
  if (fun && isFunPrintDialect(fun.dialect)) {
    const service = services.find((s) => uuidEq(s.uuid, fun.serviceUuid));
    const control = service?.characteristics.find((c) => uuidEq(c.uuid, fun.controlCharUuid));
    if (control && isWritable(control.properties)) {
      return build(service!.uuid, control.uuid, !!control.properties.writeWithoutResponse, {
        dialect: fun.dialect,
        controlCharUuid: control.uuid,
        dataCharUuid: fun.dataCharUuid,
        notifyCharUuid: fun.notifyCharUuid,
      });
    }
  }

  // Prefer known printer service/char pairs
  for (const serviceUuid of NATIVE_PRINTER_SERVICE_UUIDS) {
    const service = services.find((s) => uuidEq(s.uuid, serviceUuid));
    if (!service) continue;

    for (const knownChar of KNOWN_WRITE_CHAR_UUIDS) {
      const char = service.characteristics.find((c) => uuidEq(c.uuid, knownChar));
      if (char && isWritable(char.properties)) {
        return build(
          service.uuid,
          char.uuid,
          // Prefer WWR when available — mini printers buffer better this way
          !!char.properties.writeWithoutResponse
        );
      }
    }

    const anyWrite = service.characteristics.find((c) => isWritable(c.properties));
    if (anyWrite) {
      return build(service.uuid, anyWrite.uuid, !!anyWrite.properties.writeWithoutResponse);
    }
  }

  // Fallback: any writable characteristic outside generic GAP/GATT/Battery services
  for (const service of services) {
    if (SKIP_SERVICE_UUIDS.has(uuidKey(service.uuid))) continue;

    for (const knownChar of KNOWN_WRITE_CHAR_UUIDS) {
      const char = service.characteristics.find((c) => uuidEq(c.uuid, knownChar));
      if (char && isWritable(char.properties)) {
        return build(service.uuid, char.uuid, !!char.properties.writeWithoutResponse);
      }
    }

    // Prefer writeWithoutResponse first for bulk ESC/POS streams
    const wwr = service.characteristics.find((c) => c.properties.writeWithoutResponse);
    if (wwr) return build(service.uuid, wwr.uuid, true);

    const wr = service.characteristics.find((c) => c.properties.write);
    if (wr) return build(service.uuid, wr.uuid, false);
  }

  // Last resort: any write at all (including generic services)
  for (const service of services) {
    const anyWrite = service.characteristics.find((c) => isWritable(c.properties));
    if (anyWrite) {
      return build(service.uuid, anyWrite.uuid, !!anyWrite.properties.writeWithoutResponse);
    }
  }

  throw new Error('No write characteristic found on printer.');
};

/**
 * Open the system BLE device picker.
 * On native we deliberately do NOT filter by services — mini printers rarely
 * advertise their print service UUID, so a services filter hides them.
 */
export const nativeRequestPrinterDevice = async (preferredName?: string): Promise<BleDevice> => {
  await ensureNativeBleInitialized();
  await nativeEnsureBluetoothOn();

  const optionalServices = NATIVE_PRINTER_SERVICE_UUIDS;

  if (preferredName?.trim()) {
    try {
      return await BleClient.requestDevice({
        name: preferredName.trim(),
        optionalServices,
      });
    } catch (err) {
      if (isUserCancel(err)) throw err;
    }

    const prefix = preferredName.trim().slice(0, Math.min(6, preferredName.trim().length));
    if (prefix.length >= 2) {
      try {
        return await BleClient.requestDevice({
          namePrefix: prefix,
          optionalServices,
        });
      } catch (err) {
        if (isUserCancel(err)) throw err;
      }
    }
  }

  // Show all nearby BLE devices; optionalServices only matter for web GATT
  return BleClient.requestDevice({
    optionalServices,
  });
};

const resolveChunkSize = async (deviceId: string): Promise<number> => {
  // ATT default is 23 → 20 payload; after connect Android often negotiates higher.
  try {
    const mtu = await BleClient.getMtu(deviceId);
    // ATT header ~3 bytes; keep a safety margin and cap for unstable stacks
    return Math.max(20, Math.min(180, (mtu || 23) - 3));
  } catch {
    return 20;
  }
};

export const nativeConnectAndDiscover = async (
  deviceId: string,
  deviceName: string,
  onDisconnect?: (deviceId: string) => void
): Promise<NativeWriteChannel> => {
  await ensureNativeBleInitialized();
  await nativeEnsureBluetoothOn();

  /**
   * Do NOT disconnect before connect.
   * Many mini thermal printers power off when the phone drops GATT right after pairing.
   * Reuse an existing link when possible; only reconnect if discovery fails.
   */
  let alreadyLinked = false;
  try {
    const existing = await BleClient.getServices(deviceId);
    alreadyLinked = existing.some((s) => (s.characteristics?.length ?? 0) > 0);
  } catch {
    alreadyLinked = false;
  }

  if (!alreadyLinked) {
    try {
      await BleClient.connect(
        deviceId,
        (id) => {
          onDisconnect?.(id);
        },
        { timeout: 25_000 }
      );
    } catch (connectErr) {
      // Stale half-open session: one careful reconnect (still avoid a hard power-cycle loop)
      try {
        await BleClient.disconnect(deviceId);
      } catch {
        // ignore
      }
      await delay(400);
      await BleClient.connect(
        deviceId,
        (id) => {
          onDisconnect?.(id);
        },
        { timeout: 25_000 }
      );
      void connectErr;
    }
  } else {
    // Refresh disconnect callback for an already-open session
    try {
      await BleClient.connect(
        deviceId,
        (id) => {
          onDisconnect?.(id);
        },
        { timeout: 8_000 }
      );
    } catch {
      // Already connected — fine
    }
  }

  // Balanced priority — HIGH can brown-out / shut down weak mini-printer radios
  try {
    await BleClient.requestConnectionPriority(
      deviceId,
      ConnectionPriority.CONNECTION_PRIORITY_BALANCED
    );
  } catch {
    // iOS / unsupported — ignore
  }

  await delay(350);

  // Force a full service discovery (important on Android after cold connect)
  try {
    await BleClient.discoverServices(deviceId);
  } catch {
    // getServices will still be attempted
  }

  let services: BleService[] = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      services = await BleClient.getServices(deviceId);
      if (services.some((s) => s.characteristics?.length)) break;
    } catch {
      // retry
    }
    await delay(220 * attempt);
    try {
      await BleClient.discoverServices(deviceId);
    } catch {
      // ignore
    }
  }

  if (services.length === 0) {
    // Keep the link up — disconnecting here often powers the printer off permanently for the session.
    throw new Error(
      'Printer connected but no BLE print channel was found. Keep it awake and tap Connect again (do not power-cycle yet).'
    );
  }

  const chunkSize = await resolveChunkSize(deviceId);
  return pickWriteChannel(deviceId, deviceName || 'Thermal Printer', services, chunkSize);
};

export const nativeDisconnect = async (deviceId: string | null): Promise<void> => {
  if (!deviceId || !isNativeBlePlatform()) return;
  try {
    await BleClient.disconnect(deviceId);
  } catch {
    // ignore
  }
};

export const nativeWriteChunks = async (
  channel: NativeWriteChannel,
  data: Uint8Array,
  chunkSizeOverride?: number,
  characteristicUuid?: string
): Promise<void> => {
  await ensureNativeBleInitialized();

  const charUuid = characteristicUuid ?? channel.characteristicUuid;
  const chunkSize = Math.max(20, chunkSizeOverride ?? channel.chunkSize ?? 20);
  // Mini printers need a short inter-chunk gap; WWR can go slightly faster
  const interChunkMs = channel.writeWithoutResponse ? 12 : 22;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    // Plugin accepts DataView; numbersToDataView is the supported helper path
    const view = numbersToDataView(Array.from(chunk));

    let wrote = false;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
      try {
        if (channel.writeWithoutResponse) {
          await BleClient.writeWithoutResponse(
            channel.deviceId,
            channel.serviceUuid,
            charUuid,
            view
          );
        } else {
          await BleClient.write(
            channel.deviceId,
            channel.serviceUuid,
            charUuid,
            view
          );
        }
        wrote = true;
      } catch (err) {
        lastErr = err;
        // If WWR fails, fall back to write-with-response for remaining chunks
        if (channel.writeWithoutResponse && attempt === 1) {
          channel.writeWithoutResponse = false;
        }
        await delay(40 * (attempt + 1));
      }
    }

    if (!wrote) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error('Failed to send data to the printer.');
    }

    await delay(interChunkMs);
  }
};

export const nativeStartNotifications = async (
  channel: NativeWriteChannel,
  onValue: (bytes: Uint8Array) => void
): Promise<boolean> => {
  if (!channel.notifyCharUuid) return false;
  await ensureNativeBleInitialized();
  try {
    await BleClient.startNotifications(
      channel.deviceId,
      channel.serviceUuid,
      channel.notifyCharUuid,
      (value) => {
        try {
          const nums = dataViewToNumbers(value);
          onValue(Uint8Array.from(nums));
        } catch {
          // ignore malformed notify
        }
      }
    );
    return true;
  } catch {
    return false;
  }
};

export const nativeStopNotifications = async (channel: NativeWriteChannel | null): Promise<void> => {
  if (!channel?.notifyCharUuid) return;
  try {
    await BleClient.stopNotifications(channel.deviceId, channel.serviceUuid, channel.notifyCharUuid);
  } catch {
    // ignore
  }
};

export const nativeGetBondedOrKnown = async (deviceIds: string[]): Promise<BleDevice[]> => {
  await ensureNativeBleInitialized();

  const byId = new Map<string, BleDevice>();

  if (deviceIds.length) {
    try {
      const devices = await BleClient.getDevices(deviceIds);
      for (const d of devices) byId.set(d.deviceId, d);
    } catch {
      // ignore
    }
  }

  // Also surface OS-bonded devices so previously paired mini printers show up
  try {
    const bonded = await BleClient.getBondedDevices();
    for (const d of bonded) {
      if (d?.deviceId) byId.set(d.deviceId, d);
    }
  } catch {
    // iOS may not support getBondedDevices the same way
  }

  return [...byId.values()];
};

export const nativeIsEnabled = async (): Promise<boolean> => {
  try {
    await ensureNativeBleInitialized();
    return await BleClient.isEnabled();
  } catch {
    return false;
  }
};

/** Warm up BLE + permissions early so Scan & Connect is snappy. */
export const nativeWarmupBle = async (): Promise<void> => {
  if (!isNativeBlePlatform()) return;
  try {
    await ensureNativeBleInitialized();
  } catch {
    // permissions / adapter not ready yet — scan path will retry
  }
};
