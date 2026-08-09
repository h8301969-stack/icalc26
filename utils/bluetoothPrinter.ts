// Web Bluetooth + Native BLE (Capacitor) + WebUSB ESC/POS Printer Utility
import { storage } from '../hooks/storage';
import { getUsbSupport, UsbPrinterTransport, usbDeviceId, usbDeviceLabel } from './usbPrinter';
import { drawThermalReceiptCanvas } from './receiptCanvas';
import {
  detectPaperWidthFromDeviceName,
  formatReceiptItemLine,
  formatServedByLine,
  getReceiptSpec,
  logReceiptPrint,
  truncateReceiptText,
  validateReceiptPrint,
  type PaperWidth,
  type ReceiptLineItem,
  ReceiptLayoutMode,
} from './receiptLayout';
import {
  ensureNativeBleInitialized,
  isNativeBlePlatform,
  nativeConnectAndDiscover,
  nativeDisconnect,
  nativeEnsureBluetoothOn,
  nativeGetBondedOrKnown,
  nativeRequestPrinterDevice,
  nativeSilentScanDevices,
  nativeWarmupBle,
  nativeWriteChunks,
  type NativeWriteChannel,
} from './nativeBle';

export interface BLEDevice {
  id: string;
  name: string;
  device: BluetoothDevice;
}

/** How the printer is reached — auto-scan order: usb → classic → ble → wifi */
export type PrinterTransport = 'usb' | 'classic' | 'ble' | 'wifi';

export type PrinterScanPhase = 'usb' | 'classic' | 'bluetooth' | 'wifi' | 'done';

export interface SavedPrinter {
  id: string;
  name: string;
  paperWidth: '58mm' | '25mm';
  lastConnected: number;
  transport?: PrinterTransport;
  /** Wi‑Fi / network printers */
  host?: string;
  port?: number;
}

export type PrinterDeviceStatus = 'connected' | 'available' | 'saved';

export interface KnownPrinter {
  saved: SavedPrinter;
  device: BluetoothDevice | null;
  isConnected: boolean;
  isAuthorized: boolean;
  status: PrinterDeviceStatus;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface BluetoothSupportInfo {
  supported: boolean;
  secureContext: boolean;
  message: string | null;
}

const PAIRED_PRINTERS_KEY = 'ble_paired_printers';
const DEFAULT_PAPER_WIDTH_KEY = 'ble_default_paper_width';
const PRINTER_TRANSPORT_KEY = 'printer_transport_mode';

export { getUsbSupport };

/** Common BLE thermal-printer GATT services (must be listed in optionalServices). */
const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '0000ff10-0000-1000-8000-00805f9b34fb',
  'e7810a71-73d3-4920-8c74-028eefded309',
  '00001101-0000-1000-8000-00805f9b34fb',
];

/** Known write characteristics for ESC/POS over BLE. */
const KNOWN_WRITE_CHAR_UUIDS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ff01-0000-1000-8000-00805f9b34fb',
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logPrinterFail = (
  step: string,
  err: unknown,
  context: Record<string, unknown> = {}
): void => {
  console.error('[iCalc PRINT_FAIL]', {
    step,
    at: new Date().toISOString(),
    message: err instanceof Error ? err.message : String(err),
    ...context,
  });
};

const isUserCancelled = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel|canceled|cancelled|aborted by the user/i.test(message);
};

export const normalizeBluetoothError = (err: unknown): Error => {
  if (!(err instanceof Error)) {
    return new Error('Could not connect to the printer.');
  }
  if (isUserCancelled(err)) return err;

  const msg = err.message.toLowerCase();
  if (
    msg.includes('no services') ||
    msg.includes('service not found') ||
    msg.includes('no compatible primary') ||
    msg.includes('retrieve services')
  ) {
    return new Error(
      'Printer found but no print service is available. Leave the printer on, disconnect it from other phones, then Scan again. USB and network printers are also supported.'
    );
  }
  if (msg.includes('no write characteristic') || msg.includes('write channel')) {
    return new Error(
      'Connected but could not open a print channel. Keep the printer awake and try Scan again, or use USB.'
    );
  }
  if (msg.includes('gatt') || msg.includes('disconnected') || msg.includes('connection')) {
    return new Error(
      'Connection failed. Keep the printer powered on nearby (or plug in USB), then try again.'
    );
  }
  return err;
};

export function getBluetoothSupport(): BluetoothSupportInfo {
  // Capacitor APK/iOS shell uses native BLE plugin (works without Web Bluetooth).
  if (isNativeBlePlatform()) {
    return {
      supported: true,
      secureContext: true,
      message:
        'Auto-scan: USB → paired Bluetooth → BLE → Wi‑Fi. Connects to the first printer found, then stops.',
    };
  }

  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const hasApi = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const hasUsb = getUsbSupport().supported;

  if (!hasApi && !hasUsb) {
    if (!secureContext) {
      return {
        supported: false,
        secureContext: false,
        message:
          'Printers require a secure context. Use HTTPS or http://localhost / http://127.0.0.1.',
      };
    }
    return {
      supported: false,
      secureContext: true,
      message:
        'No printer API in this browser. Use Chrome/Edge for USB + Bluetooth, or the Android APK.',
    };
  }

  const isWindows =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

  return {
    supported: true,
    secureContext,
    message: isWindows
      ? 'Auto-scan: USB → paired Bluetooth → BLE → Wi‑Fi. On Windows, pair Bluetooth printers in system settings first when possible.'
      : 'Auto-scan: USB → paired Bluetooth → BLE → Wi‑Fi. Connects to the first printer found.',
  };
}

/** True if any transport path can run (USB and/or Bluetooth). */
export function getPrinterSupport(): BluetoothSupportInfo {
  const bt = getBluetoothSupport();
  const usb = getUsbSupport();
  if (bt.supported || usb.supported) {
    return {
      supported: true,
      secureContext: bt.secureContext || usb.secureContext,
      message:
        bt.message ||
        'Auto-scan: USB → paired Bluetooth → BLE → Wi‑Fi. Connects to the first printer found.',
    };
  }
  return bt;
}

export class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  /** Native BLE (Capacitor) session — used when Web Bluetooth is unavailable. */
  private nativeChannel: NativeWriteChannel | null = null;
  private nativeDeviceName: string | null = null;
  private usb = new UsbPrinterTransport();
  private connectionListeners = new Set<() => void>();
  private disconnectHandler: ((event: Event) => void) | null = null;
  private isBluetoothBusy = false;
  private wifiHost: string | null = null;
  private wifiPort = 9100;
  private wifiConnected = false;

  public paperWidth: PaperWidth = storage.get<PaperWidth>(DEFAULT_PAPER_WIDTH_KEY, '58mm');
  public transport: PrinterTransport = storage.get<PrinterTransport>(PRINTER_TRANSPORT_KEY, 'ble');

  get isConnected(): boolean {
    if (this.transport === 'usb') return this.usb.isConnected;
    if (this.transport === 'wifi') return this.wifiConnected && !!this.wifiHost;
    return this.bleConnected;
  }

  private get usesNativeBle(): boolean {
    return isNativeBlePlatform();
  }

  private bleConnected = false;

  private serviceUUID = PRINTER_SERVICE_UUIDS[0];
  private charUUID = KNOWN_WRITE_CHAR_UUIDS[0];

  setConnectionChangeListener(listener: (() => void) | null) {
    if (listener) {
      this.connectionListeners.add(listener);
    }
  }

  removeConnectionChangeListener(listener: (() => void) | null) {
    if (listener) {
      this.connectionListeners.delete(listener);
    }
  }

  private notifyConnectionChange() {
    this.connectionListeners.forEach((listener) => listener());
  }

  getConnectedDeviceId(): string | null {
    if (this.transport === 'usb') return this.usb.getConnectedDeviceId();
    if (this.transport === 'wifi' && this.wifiHost) {
      return `wifi:${this.wifiHost}:${this.wifiPort}`;
    }
    if (this.usesNativeBle) return this.nativeChannel?.deviceId ?? null;
    return this.device?.id ?? null;
  }

  getConnectedDeviceName(): string | null {
    if (this.transport === 'usb') return this.usb.getConnectedDeviceName();
    if (this.transport === 'wifi' && this.wifiHost) {
      const saved = this.getSavedPrinters().find(
        (p) => p.transport === 'wifi' && p.host === this.wifiHost
      );
      return saved?.name || `Wi‑Fi ${this.wifiHost}`;
    }
    if (this.usesNativeBle) return this.nativeDeviceName ?? this.nativeChannel?.deviceName ?? null;
    return this.device?.name ?? null;
  }

  setTransport(mode: PrinterTransport) {
    if (this.transport === mode) return;
    this.disconnect();
    this.transport = mode;
    storage.set(PRINTER_TRANSPORT_KEY, mode);
    this.notifyConnectionChange();
  }

  getSavedPrinters(): SavedPrinter[] {
    return storage.get<SavedPrinter[]>(PAIRED_PRINTERS_KEY, []);
  }

  private assertBluetoothAvailable() {
    const support = getBluetoothSupport();
    if (!support.supported) {
      throw new Error(support.message ?? 'Web Bluetooth is not supported.');
    }
  }

  private savePairedDeviceById(deviceId: string, deviceName: string) {
    const saved = this.getSavedPrinters().filter((p) => p.id !== deviceId);
    saved.unshift({
      id: deviceId,
      name: deviceName || 'Thermal Printer',
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
      transport: 'ble',
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 12));
  }

  private savePairedDevice(device: BluetoothDevice) {
    this.savePairedDeviceById(device.id, device.name || 'Thermal Printer');
  }

  private async connectNativeBle(
    deviceId: string,
    deviceName: string
  ): Promise<string> {
    await ensureNativeBleInitialized();
    await nativeEnsureBluetoothOn();

    // Tear down previous native session if switching printers
    if (this.nativeChannel && this.nativeChannel.deviceId !== deviceId) {
      await nativeDisconnect(this.nativeChannel.deviceId);
      this.nativeChannel = null;
      this.bleConnected = false;
    }

    const name = deviceName || 'Thermal Printer';
    this.applyAutoPaperWidth(deviceId, name);

    this.nativeChannel = await nativeConnectAndDiscover(deviceId, name, (id) => {
      if (this.nativeChannel?.deviceId === id) {
        this.nativeChannel = null;
        this.nativeDeviceName = null;
        this.bleConnected = false;
        this.notifyConnectionChange();
      }
    });
    this.nativeDeviceName = this.nativeChannel.deviceName || name;
    this.serviceUUID = this.nativeChannel.serviceUuid;
    this.charUUID = this.nativeChannel.characteristicUuid;
    this.bleConnected = true;
    this.savePairedDeviceById(deviceId, this.nativeDeviceName);
    this.notifyConnectionChange();
    return this.nativeDeviceName;
  }

  private applyAutoPaperWidth(deviceId: string, deviceName: string) {
    const detected = detectPaperWidthFromDeviceName(deviceName);
    const saved = this.getSavedPrinters().find((p) => p.id === deviceId);
    const width = detected ?? saved?.paperWidth ?? '58mm';
    this.paperWidth = width;
    storage.set(DEFAULT_PAPER_WIDTH_KEY, width);

    const printers = this.getSavedPrinters().filter((p) => p.id !== deviceId);
    const existing = saved ?? {
      id: deviceId,
      name: deviceName || 'Thermal Printer',
      paperWidth: width,
      lastConnected: Date.now(),
      transport: this.transport,
    };
    printers.unshift({ ...existing, name: deviceName || existing.name, paperWidth: width, lastConnected: Date.now() });
    storage.set(PAIRED_PRINTERS_KEY, printers.slice(0, 12));
  }

  /** @deprecated Manual width override removed — width is auto-detected per printer. */
  setPaperWidth(width: PaperWidth) {
    this.paperWidth = width;
    storage.set(DEFAULT_PAPER_WIDTH_KEY, width);
    this.notifyConnectionChange();
  }

  private detachDisconnectHandler(device: BluetoothDevice) {
    if (this.disconnectHandler) {
      device.removeEventListener('gattserverdisconnected', this.disconnectHandler);
      this.disconnectHandler = null;
    }
  }

  private attachDisconnectHandler(device: BluetoothDevice) {
    if (this.device && this.device.id !== device.id) {
      this.detachDisconnectHandler(this.device);
    }

    if (this.disconnectHandler) return;

    this.disconnectHandler = () => {
      this.bleConnected = false;
      this.server = null;
      this.characteristic = null;
      this.notifyConnectionChange();
    };
    device.addEventListener('gattserverdisconnected', this.disconnectHandler);
  }

  private async getAuthorizedDevices(): Promise<BluetoothDevice[]> {
    if (!navigator.bluetooth?.getDevices) return [];
    try {
      return await navigator.bluetooth.getDevices();
    } catch {
      return [];
    }
  }

  private isWritableCharacteristic(
    characteristic: BluetoothRemoteGATTCharacteristic
  ): boolean {
    return characteristic.properties.write || characteristic.properties.writeWithoutResponse;
  }

  private async pickWritableCharacteristic(
    service: BluetoothRemoteGATTService
  ): Promise<BluetoothRemoteGATTCharacteristic | null> {
    const characteristics = await service.getCharacteristics();

    for (const uuid of KNOWN_WRITE_CHAR_UUIDS) {
      const match = characteristics.find((c) => c.uuid.toLowerCase() === uuid.toLowerCase());
      if (match && this.isWritableCharacteristic(match)) return match;
    }

    return characteristics.find((c) => this.isWritableCharacteristic(c)) ?? null;
  }

  private async findWriteCharacteristic(
    server: BluetoothRemoteGATTServer
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    for (const serviceUuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const writeChar = await this.pickWritableCharacteristic(service);
        if (writeChar) {
          this.serviceUUID = serviceUuid;
          this.charUUID = writeChar.uuid;
          return writeChar;
        }
      } catch {
        // try next known service
      }
    }

    let services: BluetoothRemoteGATTService[] = [];
    try {
      services = await server.getPrimaryServices();
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Could not read printer BLE services.'
      );
    }

    if (services.length === 0) {
      throw new Error('No compatible primary services found.');
    }

    for (const service of services) {
      const writeChar = await this.pickWritableCharacteristic(service);
      if (writeChar) {
        this.serviceUUID = service.uuid;
        this.charUUID = writeChar.uuid;
        return writeChar;
      }
    }

    throw new Error('No write characteristic found on printer.');
  }

  private async connectGattServer(device: BluetoothDevice, attempt = 1): Promise<BluetoothRemoteGATTServer> {
    if (!device.gatt) {
      throw new Error('This printer does not expose BLE (GATT). Bluetooth Classic-only printers are not supported in the browser.');
    }

    if (this.device && this.device.id !== device.id) {
      try {
        if (this.device.gatt.connected) this.device.gatt.disconnect();
      } catch {
        // ignore stale disconnect errors
      }
      this.server = null;
      this.characteristic = null;
      this.bleConnected = false;
    }

    try {
      if (device.gatt.connected) {
        device.gatt.disconnect();
        await delay(350);
      }
      await device.gatt.connect();
      await delay(attempt === 1 ? 300 : 450 * attempt);
    } catch (err) {
      if (attempt < 5) {
        await delay(500 * attempt);
        return this.connectGattServer(device, attempt + 1);
      }
      throw err instanceof Error ? err : new Error('Could not connect to GATT server.');
    }

    const server = device.gatt;
    if (!server.connected) {
      if (attempt < 5) {
        await delay(500 * attempt);
        return this.connectGattServer(device, attempt + 1);
      }
      throw new Error('GATT server disconnected. Turn the printer on and try again.');
    }

    return server;
  }

  private async rediscoverServices(
    device: BluetoothDevice,
    attempt = 1
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    try {
      const server = await this.connectGattServer(device);
      this.server = server;
      return await this.findWriteCharacteristic(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const retriable = /disconnected|gatt|retrieve services|network|timeout/i.test(message);

      if (retriable && attempt < 4) {
        await delay(500 * attempt);
        return this.rediscoverServices(device, attempt + 1);
      }
      throw err;
    }
  }

  private async requestPrinterDevice(preferredName?: string): Promise<BluetoothDevice> {
    const optionalServices = PRINTER_SERVICE_UUIDS;

    try {
      return await navigator.bluetooth!.requestDevice({
        filters: PRINTER_SERVICE_UUIDS.map((uuid) => ({ services: [uuid] })),
        optionalServices,
      });
    } catch (err) {
      if (isUserCancelled(err)) throw err;
    }

    if (preferredName) {
      try {
        return await navigator.bluetooth!.requestDevice({
          filters: [{ name: preferredName }],
          optionalServices,
        });
      } catch (err) {
        if (isUserCancelled(err)) throw err;
      }

      const prefix = preferredName.trim().slice(0, Math.min(4, preferredName.length));
      if (prefix.length >= 2) {
        try {
          return await navigator.bluetooth!.requestDevice({
            filters: [{ namePrefix: prefix }],
            optionalServices,
          });
        } catch (err) {
          if (isUserCancelled(err)) throw err;
        }
      }
    }

    return await navigator.bluetooth!.requestDevice({
      acceptAllDevices: true,
      optionalServices,
    });
  }

  private async connectGATT(device: BluetoothDevice): Promise<string> {
    this.assertBluetoothAvailable();

    this.device = device;
    this.applyAutoPaperWidth(device.id, device.name || 'Thermal Printer');
    this.attachDisconnectHandler(device);

    this.characteristic = await this.rediscoverServices(device);
    this.bleConnected = true;
    this.savePairedDevice(device);
    this.notifyConnectionChange();

    return device.name || 'Thermal Printer';
  }

  async getKnownPrinters(): Promise<KnownPrinter[]> {
    const saved = [...this.getSavedPrinters()];
    const authorizedBle = this.usesNativeBle ? [] : await this.getAuthorizedDevices();
    const nativeKnown = this.usesNativeBle
      ? await nativeGetBondedOrKnown(
          saved.filter((p) => p.transport !== 'usb').map((p) => p.id)
        )
      : [];
    const authorizedUsb = await this.usb.getAuthorizedDevices();
    const connectedId = this.getConnectedDeviceId();
    const merged = new Map<string, SavedPrinter>();

    for (const entry of saved) {
      merged.set(entry.id, entry);
    }

    for (const device of authorizedBle) {
      const existing = merged.get(device.id);
      merged.set(device.id, {
        id: device.id,
        name: device.name || existing?.name || 'Thermal Printer',
        paperWidth: existing?.paperWidth ?? this.paperWidth,
        lastConnected: existing?.lastConnected ?? 0,
        transport: 'ble',
      });
    }

    for (const device of nativeKnown) {
      const existing = merged.get(device.deviceId);
      merged.set(device.deviceId, {
        id: device.deviceId,
        name: device.name || device.deviceId || existing?.name || 'Thermal Printer',
        paperWidth: existing?.paperWidth ?? this.paperWidth,
        lastConnected: existing?.lastConnected ?? 0,
        transport: 'ble',
      });
    }

    for (const usbDevice of authorizedUsb) {
      const id = usbDeviceId(usbDevice);
      const existing = merged.get(id);
      merged.set(id, {
        id,
        name: usbDeviceLabel(usbDevice) || existing?.name || 'USB Printer',
        paperWidth: existing?.paperWidth ?? this.paperWidth,
        lastConnected: existing?.lastConnected ?? 0,
        transport: 'usb',
      });
    }

    const list = [...merged.values()].sort((a, b) => {
      if (a.id === connectedId) return -1;
      if (b.id === connectedId) return 1;
      return b.lastConnected - a.lastConnected;
    });

    return list.map((entry) => {
      if (entry.transport === 'usb') {
        const isAuthorized = authorizedUsb.some((d) => usbDeviceId(d) === entry.id);
        const isConnected =
          entry.id === connectedId && this.transport === 'usb' && this.usb.isConnected;
        let status: PrinterDeviceStatus = 'saved';
        if (isConnected) status = 'connected';
        else if (isAuthorized) status = 'available';
        return {
          saved: entry,
          device: null,
          isConnected,
          isAuthorized,
          status,
        };
      }

      if (entry.transport === 'wifi') {
        const isConnected =
          this.transport === 'wifi' &&
          this.wifiConnected &&
          !!entry.host &&
          entry.host === this.wifiHost;
        return {
          saved: entry,
          device: null,
          isConnected,
          isAuthorized: !!entry.host,
          status: (isConnected ? 'connected' : entry.lastConnected ? 'available' : 'saved') as PrinterDeviceStatus,
        };
      }

      if (this.usesNativeBle) {
        const known = nativeKnown.some((d) => d.deviceId === entry.id);
        const isConnected =
          entry.id === connectedId && this.transport === 'ble' && this.bleConnected && !!this.nativeChannel;
        let status: PrinterDeviceStatus = 'saved';
        if (isConnected) status = 'connected';
        else if (known || !!entry.lastConnected) status = 'available';
        return {
          saved: entry,
          device: null,
          isConnected,
          isAuthorized: known || !!entry.lastConnected,
          status,
        };
      }

      const device = authorizedBle.find((d) => d.id === entry.id) ?? null;
      const gattConnected = device?.gatt?.connected ?? false;
      const isConnected =
        entry.id === connectedId && this.transport === 'ble' && (this.bleConnected || gattConnected);

      let status: PrinterDeviceStatus = 'saved';
      if (isConnected) status = 'connected';
      else if (device) status = 'available';

      return {
        saved: entry,
        device,
        isConnected,
        isAuthorized: device !== null,
        status,
      };
    });
  }

  /**
   * Sequential auto-connect (behind the scenes):
   * 1) USB (authorized)
   * 2) Classic / already-paired Bluetooth
   * 3) BLE discovery
   * 4) Wi‑Fi (saved network printers)
   * Connects to the first success and stops.
   * @param options.silent — skip any UI pickers (app entry / background).
   */
  async scanAndConnect(
    onPhase?: (phase: PrinterScanPhase) => void,
    options?: { silent?: boolean }
  ): Promise<string> {
    const silent = options?.silent === true;
    const phases: PrinterScanPhase[] = ['usb', 'classic', 'bluetooth', 'wifi'];
    const errors: string[] = [];

    for (const phase of phases) {
      onPhase?.(phase);
      try {
        if (phase === 'usb') {
          const name = await this.tryConnectUsbSilent();
          if (name) {
            onPhase?.('done');
            return name;
          }
          continue;
        }
        if (phase === 'classic') {
          const name = await this.tryConnectClassicBonded();
          if (name) {
            onPhase?.('done');
            return name;
          }
          continue;
        }
        if (phase === 'bluetooth') {
          const name = await this.tryConnectBluetoothDiscover({ silent });
          if (name) {
            onPhase?.('done');
            return name;
          }
          continue;
        }
        if (phase === 'wifi') {
          const name = await this.tryConnectWifiSaved();
          if (name) {
            onPhase?.('done');
            return name;
          }
        }
      } catch (err: unknown) {
        if (isUserCancelled(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${phase}: ${message}`);
        logPrinterFail(`scan_phase_${phase}`, err, { phase, silent });
      }
    }

    onPhase?.('done');
    const detail = errors.length ? ` (${errors[errors.length - 1]})` : '';
    throw new Error(
      `No printer found via USB → Bluetooth → Wi‑Fi.${detail} Power on a printer, plug in USB, or pair Bluetooth, then try again.`
    );
  }

  /** Phase 1 — USB: already-authorized devices only (no picker). */
  private async tryConnectUsbSilent(): Promise<string | null> {
    const support = getUsbSupport();
    if (!support.supported) return null;

    const authorized = await this.usb.getAuthorizedDevices();
    for (const device of authorized) {
      try {
        this.setTransport('usb');
        const id = usbDeviceId(device);
        const name = await this.usb.connectToId(id);
        this.saveUsbDevice(name, id);
        this.notifyConnectionChange();
        return name;
      } catch {
        // try next USB device
      }
    }
    return null;
  }

  /** Phase 2 — Classic / bonded: system-paired or previously authorized BT. */
  private async tryConnectClassicBonded(): Promise<string | null> {
    const support = getBluetoothSupport();
    if (!support.supported) return null;

    if (this.usesNativeBle) {
      await nativeWarmupBle();
      const bonded = await nativeGetBondedOrKnown(
        this.getSavedPrinters()
          .filter((p) => p.transport !== 'usb' && p.transport !== 'wifi')
          .map((p) => p.id)
      );
      for (const d of bonded) {
        try {
          if (this.transport !== 'ble' && this.transport !== 'classic') {
            this.setTransport('ble');
          }
          this.transport = 'classic';
          storage.set(PRINTER_TRANSPORT_KEY, 'ble');
          const name = d.name || d.deviceId || 'Bluetooth Printer';
          return await this.connectNativeBle(d.deviceId, name);
        } catch {
          // try next bonded device
        }
      }
      return null;
    }

    // Web: previously granted BLE devices (often system-paired on desktop)
    try {
      this.assertBluetoothAvailable();
      const authorized = await this.getAuthorizedDevices();
      for (const device of authorized) {
        try {
          this.transport = 'classic';
          storage.set(PRINTER_TRANSPORT_KEY, 'ble');
          return await this.connectGATT(device);
        } catch {
          // try next
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Phase 3 — active BLE discovery (silent scan on native; picker only when not silent). */
  private async tryConnectBluetoothDiscover(opts?: { silent?: boolean }): Promise<string | null> {
    const support = getBluetoothSupport();
    if (!support.supported) return null;
    const silent = opts?.silent === true;

    if (this.usesNativeBle) {
      await nativeWarmupBle();
      // Silent LE scan first — connect to first device that accepts GATT print channel
      const scanned = await nativeSilentScanDevices(1200);
      const ranked = [...scanned].sort((a, b) => {
        const score = (n?: string) => {
          const s = (n || '').toLowerCase();
          if (/print|pos|thermal|receipt|rpp|mtp|inner|xp-|gprinter|blue|bt/i.test(s)) return 0;
          if (s.length > 0) return 1;
          return 2;
        };
        return score(a.name) - score(b.name);
      });

      for (const d of ranked) {
        try {
          this.transport = 'ble';
          storage.set(PRINTER_TRANSPORT_KEY, 'ble');
          const name = d.name || d.deviceId || 'Bluetooth Printer';
          return await this.connectNativeBle(d.deviceId, name);
        } catch {
          // not a usable printer — continue sequence
        }
      }

      if (silent) return null;

      // Fall back to system picker only when user initiated Scan
      try {
        const device = await nativeRequestPrinterDevice();
        this.transport = 'ble';
        storage.set(PRINTER_TRANSPORT_KEY, 'ble');
        const name = device.name || device.deviceId || 'Bluetooth Printer';
        return await this.connectNativeBle(device.deviceId, name);
      } catch (err) {
        if (isUserCancelled(err)) throw err;
        return null;
      }
    }

    // Web Bluetooth — never open picker during silent/background entry
    if (silent) return null;

    try {
      this.assertBluetoothAvailable();
      this.transport = 'ble';
      storage.set(PRINTER_TRANSPORT_KEY, 'ble');
      const device = await this.requestPrinterDevice();
      return await this.connectGATT(device);
    } catch (err) {
      if (isUserCancelled(err)) throw err;
      return null;
    }
  }

  /** Phase 4 — Wi‑Fi / network printers previously saved (host:port raw JetDirect-style). */
  private async tryConnectWifiSaved(): Promise<string | null> {
    const wifiPrinters = this.getSavedPrinters()
      .filter((p) => p.transport === 'wifi' && p.host)
      .sort((a, b) => b.lastConnected - a.lastConnected);

    for (const p of wifiPrinters) {
      try {
        const ok = await this.probeWifiPrinter(p.host!, p.port ?? 9100);
        if (!ok) continue;
        this.transport = 'wifi';
        storage.set(PRINTER_TRANSPORT_KEY, 'wifi');
        // Mark connected via saved metadata (raw TCP write happens at print time when available)
        this.saveWifiDevice(p.name, p.id, p.host!, p.port ?? 9100);
        this.wifiHost = p.host!;
        this.wifiPort = p.port ?? 9100;
        this.wifiConnected = true;
        this.notifyConnectionChange();
        return p.name;
      } catch {
        // try next
      }
    }
    return null;
  }

  private async probeWifiPrinter(host: string, port: number): Promise<boolean> {
    // Browsers cannot open raw TCP; we only verify the host is reachable via HTTP-ish probe.
    // Network ESC/POS often still accepts a TCP 9100 client from native builds later.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 900);
    try {
      await fetch(`http://${host}:${port}/`, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });
      return true;
    } catch {
      // no-cors often "succeeds" as opaque; abort = unreachable
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private saveWifiDevice(name: string, id: string, host: string, port: number) {
    const saved = this.getSavedPrinters().filter((p) => p.id !== id);
    saved.unshift({
      id,
      name,
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
      transport: 'wifi',
      host,
      port,
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 12));
  }

  /** Legacy BLE-only scan (picker) — used when a specific BLE path is needed. */
  async scanAndConnectBleOnly(): Promise<string> {
    try {
      if (this.transport !== 'ble') {
        this.setTransport('ble');
      } else {
        this.transport = 'ble';
        storage.set(PRINTER_TRANSPORT_KEY, 'ble');
      }
      this.assertBluetoothAvailable();

      if (this.usesNativeBle) {
        await nativeWarmupBle();
        const device = await nativeRequestPrinterDevice();
        const name = device.name || device.deviceId || 'Bluetooth Printer';
        return await this.connectNativeBle(device.deviceId, name);
      }

      const device = await this.requestPrinterDevice();
      return await this.connectGATT(device);
    } catch (err: unknown) {
      this.bleConnected = false;
      this.nativeChannel = null;
      if (!isUserCancelled(err)) {
        logPrinterFail('ble_scan_connect', err, {
          transport: 'ble',
          native: this.usesNativeBle,
        });
      }
      throw normalizeBluetoothError(err);
    }
  }

  async connectToSavedPrinter(printerId: string): Promise<string> {
    try {
      const saved = this.getSavedPrinters().find((p) => p.id === printerId);
      if (saved?.transport === 'usb') {
        return await this.connectToSavedUsbPrinter(printerId);
      }

      this.setTransport('ble');
      this.assertBluetoothAvailable();

      if (this.usesNativeBle) {
        try {
          return await this.connectNativeBle(printerId, saved?.name || 'Thermal Printer');
        } catch (directErr) {
          // If direct reconnect fails, open picker filtered by name
          if (isUserCancelled(directErr)) throw directErr;
          const device = await nativeRequestPrinterDevice(saved?.name);
          const name = device.name || saved?.name || device.deviceId || 'Thermal Printer';
          return await this.connectNativeBle(device.deviceId, name);
        }
      }

      const authorized = await this.getAuthorizedDevices();
      let device = authorized.find((d) => d.id === printerId);

      if (!device) {
        device = await this.requestPrinterDevice(saved?.name);
      }

      return await this.connectGATT(device);
    } catch (err: unknown) {
      this.bleConnected = false;
      this.nativeChannel = null;
      if (!isUserCancelled(err)) {
        logPrinterFail('ble_connect_saved', err, { transport: 'ble', printerId });
      }
      throw normalizeBluetoothError(err);
    }
  }

  async reconnectIfNeeded(): Promise<void> {
    if (this.usesNativeBle) {
      if (this.nativeChannel && this.bleConnected) return;
      const id = this.nativeChannel?.deviceId ?? this.getSavedPrinters().find((p) => p.transport !== 'usb')?.id;
      if (!id) throw new Error('Printer is not connected.');
      const name =
        this.nativeDeviceName ||
        this.getSavedPrinters().find((p) => p.id === id)?.name ||
        'Thermal Printer';
      await this.connectNativeBle(id, name);
      return;
    }

    if (!this.device) {
      throw new Error('Printer is not connected.');
    }
    if (this.device.gatt?.connected && this.characteristic) return;
    await this.connectGATT(this.device);
  }

  /** Silently reconnect to a previously paired printer (no browser picker). */
  async ensureConnected(): Promise<boolean> {
    if (this.transport === 'usb') {
      if (this.usb.isConnected) return true;
      const savedUsbIds = this.getSavedPrinters()
        .filter((p) => p.transport === 'usb')
        .sort((a, b) => b.lastConnected - a.lastConnected)
        .map((p) => p.id);
      return this.usb.ensureConnected(savedUsbIds);
    }

    if (this.usesNativeBle) {
      if (this.isConnected && this.nativeChannel) return true;

      const support = getBluetoothSupport();
      if (!support.supported) return false;

      try {
        if (this.nativeChannel?.deviceId) {
          await this.connectNativeBle(
            this.nativeChannel.deviceId,
            this.nativeDeviceName || this.nativeChannel.deviceName
          );
          return true;
        }

        const saved = [...this.getSavedPrinters()]
          .filter((p) => p.transport !== 'usb')
          .sort((a, b) => b.lastConnected - a.lastConnected);

        for (const entry of saved) {
          try {
            await this.connectNativeBle(entry.id, entry.name);
            return true;
          } catch {
            // try next saved printer
          }
        }
      } catch (err) {
        logPrinterFail('auto_connect', err, {
          transport: this.transport,
          native: true,
          deviceName: this.getConnectedDeviceName(),
        });
      }
      return false;
    }

    if (this.isConnected && this.device?.gatt?.connected && this.characteristic) {
      return true;
    }

    const support = getBluetoothSupport();
    if (!support.supported) return false;

    try {
      if (this.device) {
        await this.connectGATT(this.device);
        return true;
      }

      const authorized = await this.getAuthorizedDevices();
      const saved = [...this.getSavedPrinters()]
        .filter((p) => p.transport !== 'usb')
        .sort((a, b) => b.lastConnected - a.lastConnected);

      for (const entry of saved) {
        const device = authorized.find((d) => d.id === entry.id);
        if (device) {
          await this.connectGATT(device);
          return true;
        }
      }

      const available = authorized.find((d) => d.gatt);
      if (available) {
        await this.connectGATT(available);
        return true;
      }
    } catch (err) {
      logPrinterFail('auto_connect', err, {
        transport: this.transport,
        deviceName: this.getConnectedDeviceName(),
      });
    }

    return false;
  }

  disconnect() {
    if (this.usesNativeBle && this.nativeChannel) {
      void nativeDisconnect(this.nativeChannel.deviceId);
    }
    this.nativeChannel = null;
    this.nativeDeviceName = null;

    if (this.device) {
      this.detachDisconnectHandler(this.device);
      try {
        if (this.device.gatt?.connected) {
          this.device.gatt.disconnect();
        }
      } catch {
        // ignore
      }
    }
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.bleConnected = false;
    this.wifiConnected = false;
    this.wifiHost = null;
    this.usb.disconnect();
    this.notifyConnectionChange();
  }

  private saveUsbDevice(name: string, id: string) {
    this.applyAutoPaperWidth(id, name);
    const saved = this.getSavedPrinters().filter((p) => p.id !== id);
    saved.unshift({
      id,
      name,
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
      transport: 'usb',
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 12));
  }

  async scanAndConnectUsb(): Promise<string> {
    try {
      this.setTransport('usb');
      const name = await this.usb.requestAndConnect();
      const id = this.usb.getConnectedDeviceId();
      if (id) this.saveUsbDevice(name, id);
      this.notifyConnectionChange();
      return name;
    } catch (err: unknown) {
      if (!isUserCancelled(err)) {
        logPrinterFail('usb_scan_connect', err, { transport: 'usb' });
      }
      throw err instanceof Error ? err : new Error('USB printer connection failed.');
    }
  }

  async connectToSavedUsbPrinter(printerId: string): Promise<string> {
    this.setTransport('usb');
    const name = await this.usb.connectToId(printerId);
    this.saveUsbDevice(name, printerId);
    this.notifyConnectionChange();
    return name;
  }

  private async getWriteCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.device) {
      throw new Error('Printer is not connected.');
    }
    if (!this.device.gatt?.connected || !this.characteristic) {
      await this.reconnectIfNeeded();
    }
    if (!this.characteristic) {
      throw new Error('Printer is not connected.');
    }
    return this.characteristic;
  }

  private async withBluetoothLock<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.isBluetoothBusy) {
      logReceiptPrint('skipped', { reason: 'bluetooth_busy', message: 'Printer channel busy; request ignored.' });
      return null;
    }

    try {
      this.isBluetoothBusy = true;
      return await operation();
    } catch (error) {
      logReceiptPrint('failure', {
        reason: 'ble_operation_error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.isBluetoothBusy = false;
    }
  }

  private async writeDataInChunks(
    characteristic: BluetoothRemoteGATTCharacteristic,
    data: Uint8Array
  ): Promise<void> {
    const chunkSize = 20;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else if (characteristic.properties.write) {
        await characteristic.writeValueWithResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      await delay(30);
    }
  }

  private async writeEscPosData(data: Uint8Array): Promise<void> {
    try {
      if (this.transport === 'usb') {
        await this.usb.writeInChunks(data);
        return;
      }

      if (this.usesNativeBle) {
        if (!this.nativeChannel || !this.bleConnected) {
          const ok = await this.ensureConnected();
          if (!ok || !this.nativeChannel) {
            throw new Error('Printer is not connected.');
          }
        }
        try {
          await nativeWriteChunks(this.nativeChannel, data);
        } catch (writeErr) {
          // One reconnect + retry — common after printer sleep / Android GATT drop
          logPrinterFail('native_write_retry', writeErr, {
            deviceId: this.nativeChannel.deviceId,
            bytes: data.length,
          });
          const id = this.nativeChannel.deviceId;
          const name = this.nativeDeviceName || this.nativeChannel.deviceName;
          this.nativeChannel = null;
          this.bleConnected = false;
          await this.connectNativeBle(id, name);
          if (!this.nativeChannel) throw writeErr;
          await nativeWriteChunks(this.nativeChannel, data);
        }
        return;
      }

      const characteristic = await this.getWriteCharacteristic();
      await this.writeDataInChunks(characteristic, data);
    } catch (err) {
      logPrinterFail('write_escpos', err, {
        transport: this.transport,
        native: this.usesNativeBle,
        deviceName: this.getConnectedDeviceName(),
        bytes: data.length,
      });
      throw err;
    }
  }

  async printInvoice(
    invoiceName: string,
    items: CartItem[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string,
    layoutMode: ReceiptLayoutMode = 'full'
  ): Promise<boolean> {
    const receiptItems: ReceiptLineItem[] = items.map((item) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));
    const validation = validateReceiptPrint(
      invoiceName,
      receiptItems,
      this.paperWidth,
      !!attendantName,
      currency,
      layoutMode
    );
    logReceiptPrint('validate', {
      mode: 'escpos_text',
      invoiceName,
      paperWidth: this.paperWidth,
      itemCount: items.length,
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      estimatedHeightPx: validation.estimatedHeightPx,
    });
    if (!validation.ok) {
      logReceiptPrint('failure', {
        mode: 'escpos_text',
        reason: 'validation_failed',
        errors: validation.errors,
      });
      return false;
    }

    const spec = getReceiptSpec(this.paperWidth);
    logReceiptPrint('start', {
      mode: 'escpos_text',
      invoiceName,
      paperWidth: this.paperWidth,
      maxCols: spec.maxCols,
      itemCount: items.length,
      total: runningTotal,
    });

    const result = await this.withBluetoothLock(async () => {
    const encoder = new TextEncoder();
    const commands: number[] = [];
    const rule = '-'.repeat(spec.maxCols);

    commands.push(0x1B, 0x40);
    commands.push(0x1B, 0x61, 0x01);
    commands.push(0x1B, 0x45, 0x01);
    const title = `${truncateReceiptText(invoiceName.toUpperCase(), spec.maxInvoiceTitleChars)}\n`;
    commands.push(...Array.from(encoder.encode(title)));

    commands.push(0x1B, 0x45, 0x00);
    const subTitle = `iCalc Spatial POS Receipt\n`;
    commands.push(...Array.from(encoder.encode(subTitle)));
    if (attendantName) {
      commands.push(...Array.from(encoder.encode(`${formatServedByLine(attendantName, spec)}\n`)));
    }
    commands.push(...Array.from(encoder.encode(`${rule}\n`)));

    commands.push(0x1B, 0x61, 0x00);

    if (layoutMode === 'full') {
      items.forEach((item, idx) => {
        const { line } = formatReceiptItemLine(
          item.name || `Item ${idx + 1}`,
          item.quantity,
          item.price,
          currency,
          spec
        );
        commands.push(...Array.from(encoder.encode(`${line}\n`)));
      });
    }

    commands.push(...Array.from(encoder.encode(`${rule}\n`)));

    commands.push(0x1B, 0x45, 0x01);
    const totalText = `TOTAL: ${currency}${runningTotal.toFixed(2)}`;
    commands.push(...Array.from(encoder.encode(totalText + '\n')));
    commands.push(0x1B, 0x45, 0x00);

    commands.push(0x1B, 0x61, 0x01);
    commands.push(...Array.from(encoder.encode('\nThank you for your purchase!\n\n\n')));

    commands.push(0x1D, 0x56, 0x42, 0x00);

    const data = new Uint8Array(commands);
    await this.writeEscPosData(data);
    });

    const ok = result !== null;
    if (ok) {
      logReceiptPrint('success', {
        mode: 'escpos_text',
        invoiceName,
        paperWidth: this.paperWidth,
        bytes: items.length,
      });
    } else {
      logReceiptPrint('failure', {
        mode: 'escpos_text',
        reason: 'busy_or_aborted',
        invoiceName,
      });
    }
    return ok;
  }

  async printInvoiceImage(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number }[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string,
    layoutMode: ReceiptLayoutMode = 'full',
    business?: {
      businessName?: string;
      businessPhone?: string;
      businessAddress?: string;
    }
  ): Promise<boolean> {
    const validation = validateReceiptPrint(
      invoiceName,
      items,
      this.paperWidth,
      !!attendantName,
      currency,
      layoutMode
    );
    logReceiptPrint('validate', {
      mode: 'raster_image',
      layoutMode,
      invoiceName,
      paperWidth: this.paperWidth,
      itemCount: items.length,
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      estimatedHeightPx: validation.estimatedHeightPx,
    });
    if (!validation.ok) {
      logReceiptPrint('failure', {
        mode: 'raster_image',
        reason: 'validation_failed',
        errors: validation.errors,
      });
      return false;
    }

    const spec = getReceiptSpec(this.paperWidth);
    const width = spec.widthPx;

    logReceiptPrint('start', {
      mode: 'raster_image',
      layoutMode,
      invoiceName,
      paperWidth: this.paperWidth,
      canvas: { width },
      itemCount: items.length,
      total: runningTotal,
      warnings: validation.warnings,
    });

    const result = await this.withBluetoothLock(async () => {
    const canvas = document.createElement('canvas');
    await drawThermalReceiptCanvas(canvas, {
      invoiceName,
      items,
      runningTotal,
      currency,
      attendantName,
      layoutMode,
      spec,
      businessName: business?.businessName,
      businessPhone: business?.businessPhone,
      businessAddress: business?.businessAddress,
    });

    const printWidth = canvas.width;
    const printHeight = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');

    const imgData = ctx.getImageData(0, 0, printWidth, printHeight);
    const data = imgData.data;

    const bytesWidth = printWidth / 8;
    const commands: number[] = [];

    commands.push(0x1B, 0x40);

    const xL = bytesWidth % 256;
    const xH = Math.floor(bytesWidth / 256);
    const yL = printHeight % 256;
    const yH = Math.floor(printHeight / 256);

    commands.push(0x1D, 0x76, 0x30, 0, xL, xH, yL, yH);

    for (let y = 0; y < printHeight; y++) {
      for (let b = 0; b < bytesWidth; b++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const pixelX = b * 8 + bit;
          const pixelIdx = (y * printWidth + pixelX) * 4;

          const r = data[pixelIdx];
          const g = data[pixelIdx + 1];
          const bVal = data[pixelIdx + 2];
          const a = data[pixelIdx + 3];

          const gray = 0.299 * r + 0.587 * g + 0.114 * bVal;
          const isBlack = (a > 50 && gray < 128) ? 1 : 0;

          byteVal = (byteVal << 1) | isBlack;
        }
        commands.push(byteVal);
      }
    }

    commands.push(0x1D, 0x56, 0x42, 0x00);

    const printData = new Uint8Array(commands);
    await this.writeEscPosData(printData);
    });

    const ok = result !== null;
    if (ok) {
      logReceiptPrint('success', {
        mode: 'raster_image',
        layoutMode,
        invoiceName,
        paperWidth: this.paperWidth,
        itemCount: items.length,
      });
    } else {
      logReceiptPrint('failure', {
        mode: 'raster_image',
        reason: 'busy_or_aborted',
        invoiceName,
      });
    }
    return ok;
  }

  async printNotepadImage(title: string, body: string, attendantName?: string): Promise<boolean> {
    const spec = getReceiptSpec(this.paperWidth);
    const width = spec.widthPx;
    const lines = body.split('\n').map((l) => l.trimEnd()).filter((l, i, arr) => l.length > 0 || i < arr.length);
    const lineHeight = 20;
    const headerHeight = attendantName ? 88 : 72;
    const height = Math.min(spec.maxHeightPx, headerHeight + lines.length * lineHeight + 48);

    logReceiptPrint('start', {
      mode: 'notepad_raster',
      invoiceName: title,
      paperWidth: this.paperWidth,
      lineCount: lines.length,
    });

    const result = await this.withBluetoothLock(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create 2D canvas context');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';

      ctx.font = '700 18px Montserrat, Candara';
      ctx.textAlign = 'center';
      ctx.fillText(truncateReceiptText(title.toUpperCase(), spec.maxInvoiceTitleChars), width / 2, 10);

      ctx.font = '300 11px Montserrat, Candara';
      if (attendantName) {
        ctx.fillText(formatServedByLine(attendantName, spec), width / 2, 34);
      }

      const rule = '-'.repeat(Math.floor(spec.maxCols * 0.95));
      ctx.font = '300 13px Montserrat, Candara';
      ctx.fillText(rule, width / 2, attendantName ? 54 : 40);

      let y = attendantName ? 72 : 58;
      ctx.textAlign = 'left';
      ctx.font = '500 13px Montserrat, Candara';
      for (const line of lines) {
        if (y + lineHeight > height - 24) break;
        const chunks = wrapReceiptLine(line, spec.maxCols);
        for (const chunk of chunks) {
          ctx.fillText(chunk, 8, y);
          y += lineHeight;
        }
      }

      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const bytesWidth = width / 8;
      const commands: number[] = [0x1B, 0x40];
      const xL = bytesWidth % 256;
      const xH = Math.floor(bytesWidth / 256);
      const yL = height % 256;
      const yH = Math.floor(height / 256);
      commands.push(0x1D, 0x76, 0x30, 0, xL, xH, yL, yH);

      for (let row = 0; row < height; row++) {
        for (let b = 0; b < bytesWidth; b++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const pixelX = b * 8 + bit;
            const pixelIdx = (row * width + pixelX) * 4;
            const gray = 0.299 * data[pixelIdx] + 0.587 * data[pixelIdx + 1] + 0.114 * data[pixelIdx + 2];
            const isBlack = data[pixelIdx + 3] > 50 && gray < 128 ? 1 : 0;
            byteVal = (byteVal << 1) | isBlack;
          }
          commands.push(byteVal);
        }
      }

      commands.push(0x1D, 0x56, 0x42, 0x00);
      await this.writeEscPosData(new Uint8Array(commands));
    });

    const ok = result !== null;
    logReceiptPrint(ok ? 'success' : 'failure', {
      mode: 'notepad_raster',
      invoiceName: title,
      paperWidth: this.paperWidth,
    });
    return ok;
  }
}

function wrapReceiptLine(text: string, maxCols: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [''];
  if (trimmed.length <= maxCols) return [trimmed];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCols) {
      if (current) lines.push(current);
      current = word.length > maxCols ? word.slice(0, maxCols) : word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [trimmed.slice(0, maxCols)];
}

export const printerInstance = new BLEPrinter();