// Web Bluetooth + Native BLE (Capacitor) + WebUSB + WiFi/network ESC/POS Printer Utility
import { storage } from '../hooks/storage';
import { getUsbSupport, UsbPrinterTransport, usbDeviceId, usbDeviceLabel } from './usbPrinter';
import {
  getNetworkPrinterSupport,
  NetworkPrinterTransport,
  type NetworkPrinterConfig,
} from './networkPrinter';
import { drawThermalReceiptCanvas } from './receiptCanvas';
import { renderInvoiceShareImage } from './invoiceShareImage';
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
  nativeWarmupBle,
  nativeWriteChunks,
  type NativeWriteChannel,
} from './nativeBle';

export interface BLEDevice {
  id: string;
  name: string;
  device: BluetoothDevice;
}

/** Connection path: USB first, then Bluetooth BLE, then WiFi/network. */
export type PrinterTransport = 'usb' | 'ble' | 'network';

export interface SavedPrinter {
  id: string;
  name: string;
  paperWidth: '58mm' | '25mm';
  lastConnected: number;
  transport?: PrinterTransport;
  /** For network printers: host IP */
  host?: string;
  /** For network printers: raw port (default 9100) */
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
export { getNetworkPrinterSupport };
export type { NetworkPrinterConfig };

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
      'Printer found but no BLE print service is available. Use a BLE thermal printer (not Bluetooth Classic-only), turn it on, disconnect it from other phones, then tap Scan & Connect again.'
    );
  }
  if (msg.includes('no write characteristic') || msg.includes('write channel')) {
    return new Error(
      'Connected to the printer but could not find a print channel. Try Scan & Connect again with the printer awake and unpaired from other devices.'
    );
  }
  if (msg.includes('gatt') || msg.includes('disconnected') || msg.includes('connection')) {
    return new Error(
      'Bluetooth connection failed. Keep the printer powered on and within 1–2 meters, then try again.'
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
        'Native Bluetooth ready. Power on your mini thermal printer (BLE), tap Search, pick it from the list, then print. Classic-only Bluetooth printers are not supported.',
    };
  }

  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const hasApi = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  if (!hasApi) {
    if (!secureContext) {
      return {
        supported: false,
        secureContext: false,
        message:
          'Bluetooth requires a secure context. Use HTTPS or open via http://localhost / http://127.0.0.1 (not plain HTTP on a network IP).',
      };
    }
    return {
      supported: false,
      secureContext: true,
      message:
        'Web Bluetooth is not available in this browser. Download the Android APK for native BLE printing, or use Chrome/Edge.',
    };
  }

  const isWindows =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

  return {
    supported: true,
    secureContext,
    message: isWindows
      ? 'On Windows, pair the printer in Bluetooth settings first, then use Scan & Connect. The printer must support BLE (not Bluetooth Classic only).'
      : null,
  };
}

export class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  /** Native BLE (Capacitor) session — used when Web Bluetooth is unavailable. */
  private nativeChannel: NativeWriteChannel | null = null;
  private nativeDeviceName: string | null = null;
  private usb = new UsbPrinterTransport();
  private network = new NetworkPrinterTransport();
  private connectionListeners = new Set<() => void>();
  private disconnectHandler: ((event: Event) => void) | null = null;
  private isBluetoothBusy = false;
  private autoConnectTimer: ReturnType<typeof setInterval> | null = null;
  private autoConnectRunning = false;
  private autoConnectStarted = false;
  /** Soft BLE keep-alive — many mini printers power off seconds after the link goes idle. */
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly KEEP_ALIVE_MS = 18_000;
  /**
   * Print loop: 0 = thermal raster receipt, 1 = share-style image raster, then repeats.
   * Cheap BLE heads often ignore ESC/POS text and only burn GS v 0 bitmaps.
   */
  private invoicePrintPass = 0;

  public paperWidth: PaperWidth = storage.get<PaperWidth>(DEFAULT_PAPER_WIDTH_KEY, '58mm');
  public transport: PrinterTransport = storage.get<PrinterTransport>(PRINTER_TRANSPORT_KEY, 'ble');

  get isConnected(): boolean {
    if (this.transport === 'usb') return this.usb.isConnected;
    if (this.transport === 'network') return this.network.isConnected;
    if (this.usesNativeBle) return this.bleConnected && !!this.nativeChannel;
    return this.bleConnected && !!this.device?.gatt?.connected && !!this.characteristic;
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
    if (this.transport === 'network') return this.network.getConnectedDeviceId();
    if (this.usesNativeBle) return this.nativeChannel?.deviceId ?? null;
    return this.device?.id ?? null;
  }

  getConnectedDeviceName(): string | null {
    if (this.transport === 'usb') return this.usb.getConnectedDeviceName();
    if (this.transport === 'network') return this.network.getConnectedDeviceName();
    if (this.usesNativeBle) return this.nativeDeviceName ?? this.nativeChannel?.deviceName ?? null;
    return this.device?.name ?? null;
  }

  /** Active print format for the current transport (shown in UI). */
  getActivePrintFormat(): {
    transport: PrinterTransport;
    protocol: string;
    modes: string[];
    paperWidth: PaperWidth;
    summary: string;
  } {
    const protocol =
      this.transport === 'network'
        ? 'ESC/POS over TCP (raw port 9100)'
        : this.transport === 'usb'
          ? 'ESC/POS over USB bulk transfer'
          : 'ESC/POS over Bluetooth LE GATT';
    return {
      transport: this.transport,
      protocol,
      modes: ['escpos_text', 'raster_image (GS v 0)'],
      paperWidth: this.paperWidth,
      summary: `${protocol} · paper ${this.paperWidth} · text + raster bitmap`,
    };
  }

  /**
   * Switch transport without tearing down the target path.
   * Only disconnects other transports so auto-connect can hand off cleanly.
   */
  setTransport(mode: PrinterTransport) {
    if (this.transport === mode) {
      storage.set(PRINTER_TRANSPORT_KEY, mode);
      return;
    }

    if (mode !== 'ble') this.disconnectBleOnly();
    if (mode !== 'usb') this.usb.disconnect();
    if (mode !== 'network') this.network.disconnect();

    this.transport = mode;
    storage.set(PRINTER_TRANSPORT_KEY, mode);
    this.notifyConnectionChange();
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    if (this.transport !== 'ble') return;
    this.keepAliveTimer = setInterval(() => {
      void this.sendBleKeepAlive();
    }, BLEPrinter.KEEP_ALIVE_MS);
  }

  /** Tiny no-print init tick so the printer stays awake while the app holds GATT. */
  private async sendBleKeepAlive(): Promise<void> {
    if (this.transport !== 'ble' || this.isBluetoothBusy || !this.bleConnected) return;
    try {
      const tick = new Uint8Array([0x1b, 0x40]); // ESC @ soft wake
      if (this.usesNativeBle) {
        if (!this.nativeChannel) return;
        await nativeWriteChunks(this.nativeChannel, tick);
        return;
      }
      if (!this.device?.gatt?.connected || !this.characteristic) return;
      await this.writeDataInChunks(this.characteristic, tick);
    } catch {
      // Ignore — next print/ensureConnected will recover
    }
  }

  private disconnectBleOnly() {
    this.stopKeepAlive();
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

    // Tear down previous native session only when switching to a different printer.
    // Never bounce the same device — disconnect powers many mini printers off.
    if (this.nativeChannel && this.nativeChannel.deviceId !== deviceId) {
      this.stopKeepAlive();
      await nativeDisconnect(this.nativeChannel.deviceId);
      this.nativeChannel = null;
      this.bleConnected = false;
    }

    const name = deviceName || 'Thermal Printer';
    this.applyAutoPaperWidth(deviceId, name);

    this.nativeChannel = await nativeConnectAndDiscover(deviceId, name, (id) => {
      if (this.nativeChannel?.deviceId === id) {
        this.stopKeepAlive();
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
    this.startKeepAlive();
    // Claim the link gently so the head stays awake after pairing
    try {
      await this.writeEscPosData(new Uint8Array([0x1b, 0x40]));
    } catch {
      // Some heads reject wake before first real print — connection can still be fine
    }
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
    this.startKeepAlive();
    this.notifyConnectionChange();

    return device.name || 'Thermal Printer';
  }

  async getKnownPrinters(): Promise<KnownPrinter[]> {
    const saved = [...this.getSavedPrinters()];
    const authorizedBle = this.usesNativeBle ? [] : await this.getAuthorizedDevices();
    const nativeKnown = this.usesNativeBle
      ? await nativeGetBondedOrKnown(
          saved.filter((p) => p.transport === 'ble' || !p.transport).map((p) => p.id)
        )
      : [];
    const authorizedUsb = await this.usb.getAuthorizedDevices();
    const networkSaved = this.network.listSaved();
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

    for (const net of networkSaved) {
      const existing = merged.get(net.id);
      merged.set(net.id, {
        id: net.id,
        name: net.name || existing?.name || `WiFi ${net.host}`,
        paperWidth: existing?.paperWidth ?? this.paperWidth,
        lastConnected: Math.max(existing?.lastConnected ?? 0, net.lastConnected),
        transport: 'network',
        host: net.host,
        port: net.port,
      });
    }

    const list = [...merged.values()].sort((a, b) => {
      if (a.id === connectedId) return -1;
      if (b.id === connectedId) return 1;
      const rank = (t?: PrinterTransport) => (t === 'usb' ? 0 : t === 'ble' ? 1 : t === 'network' ? 2 : 3);
      const r = rank(a.transport) - rank(b.transport);
      if (r !== 0) return r;
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

      if (entry.transport === 'network') {
        const isConnected =
          entry.id === connectedId && this.transport === 'network' && this.network.isConnected;
        let status: PrinterDeviceStatus = 'saved';
        if (isConnected) status = 'connected';
        else if (entry.lastConnected > 0) status = 'available';
        return {
          saved: entry,
          device: null,
          isConnected,
          isAuthorized: true,
          status,
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

  async scanAndConnect(): Promise<string> {
    try {
      // Prefer BLE without tearing down an existing native session first
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
        const name = device.name || device.deviceId || 'Thermal Printer';
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
      if (saved?.transport === 'network' || printerId.startsWith('net:')) {
        return await this.connectToSavedNetworkPrinter(printerId);
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

  /**
   * Silently reconnect using preferred order: USB → Bluetooth → WiFi/network.
   * Does not open browser pickers.
   */
  async ensureConnected(): Promise<boolean> {
    if (this.isConnected) return true;
    try {
      await this.autoConnectPreferredSequence(12000);
      return this.isConnected;
    } catch {
      return false;
    }
  }

  /**
   * Preferred connection sequence: USB → Bluetooth LE → WiFi/network.
   */
  async autoConnectPreferredSequence(
    timeoutMs = 20000
  ): Promise<{ transport: PrinterTransport; name: string; format: string }> {
    if (this.isConnected) {
      const format = this.getActivePrintFormat();
      return {
        transport: this.transport,
        name: this.getConnectedDeviceName() ?? 'Printer',
        format: format.summary,
      };
    }

    const stepMs = Math.max(1800, Math.floor(timeoutMs / 5));
    const raceTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
      ]);

    // 1) USB — authorized devices (saved first, then any WebUSB grant)
    try {
      const usbSupport = getUsbSupport();
      if (usbSupport.supported) {
        const savedUsbIds = this.getSavedPrinters()
          .filter((p) => p.transport === 'usb')
          .sort((a, b) => b.lastConnected - a.lastConnected)
          .map((p) => p.id);
        const ok = await raceTimeout(this.usb.ensureConnected(savedUsbIds), stepMs);
        if (ok && this.usb.isConnected) {
          this.setTransport('usb');
          const name = this.usb.getConnectedDeviceName() ?? 'USB Printer';
          const id = this.usb.getConnectedDeviceId();
          if (id) this.saveUsbDevice(name, id);
          this.notifyConnectionChange();
          return {
            transport: 'usb',
            name,
            format: this.getActivePrintFormat().summary,
          };
        }
      }
    } catch (err) {
      logPrinterFail('auto_usb_connect', err, { transport: 'usb' });
    }

    // 2a) Native BLE (Capacitor APK)
    try {
      if (this.usesNativeBle) {
        const support = getBluetoothSupport();
        if (support.supported) {
          if (this.nativeChannel?.deviceId) {
            try {
              await raceTimeout(
                this.connectNativeBle(
                  this.nativeChannel.deviceId,
                  this.nativeDeviceName || this.nativeChannel.deviceName
                ),
                stepMs
              );
              this.setTransport('ble');
              return {
                transport: 'ble',
                name: this.getConnectedDeviceName() ?? 'BLE Printer',
                format: this.getActivePrintFormat().summary,
              };
            } catch {
              // fall through to saved list
            }
          }

          const saved = [...this.getSavedPrinters()]
            .filter((p) => p.transport === 'ble' || !p.transport)
            .sort((a, b) => b.lastConnected - a.lastConnected);

          for (const entry of saved) {
            try {
              await raceTimeout(this.connectNativeBle(entry.id, entry.name), stepMs);
              this.setTransport('ble');
              return {
                transport: 'ble',
                name: this.getConnectedDeviceName() ?? entry.name,
                format: this.getActivePrintFormat().summary,
              };
            } catch {
              // try next
            }
          }
        }
      }
    } catch (err) {
      logPrinterFail('auto_native_ble_connect', err, { native: true });
    }

    // 2b) Web Bluetooth saved / authorized (no picker)
    try {
      if (!this.usesNativeBle) {
        const support = getBluetoothSupport();
        if (support.supported) {
          if (this.device) {
            try {
              await raceTimeout(this.connectGATT(this.device), stepMs);
              this.setTransport('ble');
              return {
                transport: 'ble',
                name: this.getConnectedDeviceName() ?? 'BLE Printer',
                format: this.getActivePrintFormat().summary,
              };
            } catch {
              // continue
            }
          }

          const authorized = await this.getAuthorizedDevices();
          const saved = [...this.getSavedPrinters()]
            .filter((p) => p.transport === 'ble' || !p.transport)
            .sort((a, b) => b.lastConnected - a.lastConnected);

          for (const entry of saved) {
            const device = authorized.find((d) => d.id === entry.id);
            if (!device) continue;
            try {
              await raceTimeout(this.connectGATT(device), stepMs);
              this.setTransport('ble');
              return {
                transport: 'ble',
                name: this.getConnectedDeviceName() ?? entry.name,
                format: this.getActivePrintFormat().summary,
              };
            } catch {
              // try next
            }
          }

          const available = authorized.find((d) => d.gatt);
          if (available) {
            await raceTimeout(this.connectGATT(available), stepMs);
            this.setTransport('ble');
            return {
              transport: 'ble',
              name: this.getConnectedDeviceName() ?? available.name ?? 'BLE Printer',
              format: this.getActivePrintFormat().summary,
            };
          }
        }
      }
    } catch (err) {
      logPrinterFail('auto_web_ble_connect', err, { transport: 'ble' });
    }

    // 3) WiFi / network (saved IPs only — no discovery without mDNS)
    try {
      const netIds = this.getSavedPrinters()
        .filter((p) => p.transport === 'network')
        .sort((a, b) => b.lastConnected - a.lastConnected)
        .map((p) => p.id);
      const alsoSaved = this.network.listSaved().map((p) => p.id);
      const preferred = [...new Set([...netIds, ...alsoSaved])];
      if (preferred.length > 0) {
        const ok = await raceTimeout(this.network.ensureConnected(preferred), stepMs);
        if (ok && this.network.isConnected) {
          this.setTransport('network');
          const name = this.network.getConnectedDeviceName() ?? 'WiFi Printer';
          const cfg = this.network.getActiveConfig();
          if (cfg) this.saveNetworkDevice(cfg);
          this.notifyConnectionChange();
          return {
            transport: 'network',
            name,
            format: this.getActivePrintFormat().summary,
          };
        }
      }
    } catch (err) {
      logPrinterFail('auto_network_connect', err, { transport: 'network' });
    }

    throw new Error(
      'No printer available. Connect USB, pair Bluetooth (BLE thermal), or add a WiFi printer IP in Settings.'
    );
  }

  /**
   * While the calculator is open: scan known printers on an interval and
   * auto-connect in USB → Bluetooth → WiFi order. Silent (no pickers).
   */
  startBackgroundAutoConnect(intervalMs = 40000): void {
    if (this.autoConnectStarted) return;
    this.autoConnectStarted = true;

    const run = async () => {
      if (this.autoConnectRunning || this.isConnected || this.isBluetoothBusy) return;
      this.autoConnectRunning = true;
      try {
        const result = await this.autoConnectPreferredSequence(12000);
        console.info('[Printer] Auto-connected', result.transport, result.name, result.format);
      } catch (err) {
        console.info(
          '[Printer] Auto-scan idle',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        this.autoConnectRunning = false;
      }
    };

    void run();
    this.autoConnectTimer = setInterval(() => {
      void run();
    }, intervalMs);
  }

  stopBackgroundAutoConnect(): void {
    if (this.autoConnectTimer) {
      clearInterval(this.autoConnectTimer);
      this.autoConnectTimer = null;
    }
    this.autoConnectStarted = false;
  }

  disconnect() {
    this.disconnectBleOnly();
    this.usb.disconnect();
    this.network.disconnect();
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

  private saveNetworkDevice(cfg: NetworkPrinterConfig) {
    this.applyAutoPaperWidth(cfg.id, cfg.name);
    const saved = this.getSavedPrinters().filter((p) => p.id !== cfg.id);
    saved.unshift({
      id: cfg.id,
      name: cfg.name,
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
      transport: 'network',
      host: cfg.host,
      port: cfg.port,
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

  async connectNetworkPrinter(opts: {
    host: string;
    port?: number;
    name?: string;
  }): Promise<string> {
    try {
      this.setTransport('network');
      const name = await this.network.connect(opts);
      const cfg = this.network.getActiveConfig();
      if (cfg) this.saveNetworkDevice(cfg);
      this.notifyConnectionChange();
      return name;
    } catch (err: unknown) {
      logPrinterFail('network_connect', err, { transport: 'network', host: opts.host });
      throw err instanceof Error ? err : new Error('WiFi printer connection failed.');
    }
  }

  async connectToSavedNetworkPrinter(printerId: string): Promise<string> {
    this.setTransport('network');
    const name = await this.network.connectToId(printerId);
    const cfg = this.network.getActiveConfig();
    if (cfg) this.saveNetworkDevice(cfg);
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

  /**
   * Cheap ESC/POS heads expect single-byte text (CP437/ASCII), not UTF-8.
   * Multi-byte chars (e.g. ¢) often advance paper via cut/feed but burn nothing.
   */
  private encodeEscPosText(text: string): number[] {
    const replacements: Record<string, string> = {
      '¢': 'c',
      '₵': 'c',
      '€': 'EUR',
      '£': 'GBP',
      '¥': 'Y',
      '—': '-',
      '–': '-',
      '‘': "'",
      '’': "'",
      '“': '"',
      '”': '"',
      '…': '...',
      '×': 'x',
      '·': '.',
    };
    let s = String(text ?? '');
    for (const [from, to] of Object.entries(replacements)) {
      if (s.includes(from)) s = s.split(from).join(to);
    }
    try {
      s = s.normalize('NFD').replace(/\p{M}/gu, '');
    } catch {
      // Older engines without Unicode property escapes — keep as-is.
    }
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 0x0a || code === 0x0d) {
        out.push(code);
      } else if (code >= 0x20 && code <= 0x7e) {
        out.push(code);
      } else {
        out.push(0x3f); // ?
      }
    }
    return out;
  }

  private async writeEscPosData(data: Uint8Array): Promise<void> {
    try {
      if (!this.isConnected) {
        const ok = await this.ensureConnected();
        if (!ok || !this.isConnected) {
          throw new Error('Printer is not connected.');
        }
      }

      if (this.transport === 'usb') {
        await this.usb.writeInChunks(data);
        return;
      }

      if (this.transport === 'network') {
        await this.network.writeInChunks(data);
        return;
      }

      if (this.usesNativeBle) {
        if (!this.nativeChannel || !this.bleConnected) {
          throw new Error('Printer is not connected.');
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
          this.setTransport('ble');
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

  /**
   * Invoice print loop (visible on cheap BLE heads):
   * 1st press → thermal raster receipt (GS v 0)
   * 2nd press → share-style image raster (GS v 0)
   * then repeats.
   */
  async printInvoice(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number; id?: string }[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string,
    layoutMode: ReceiptLayoutMode = 'full',
    _business?: { name?: string; phone?: string; address?: string }
  ): Promise<boolean> {
    const pass = this.invoicePrintPass % 2;
    this.invoicePrintPass += 1;

    logReceiptPrint('start', {
      mode: pass === 0 ? 'raster_receipt' : 'raster_share_image',
      invoiceName,
      printPass: pass,
      paperWidth: this.paperWidth,
    });

    if (pass === 0) {
      return this.printInvoiceImage(
        invoiceName,
        items,
        runningTotal,
        currency,
        attendantName,
        layoutMode
      );
    }

    return this.printInvoiceShareImageRaster(
      invoiceName,
      items,
      runningTotal,
      currency,
      attendantName,
      layoutMode
    );
  }

  /** Scale any canvas to paper width (multiple of 8) and burn via GS v 0. */
  private async sendCanvasAsGsV0(source: HTMLCanvasElement): Promise<void> {
    const spec = getReceiptSpec(this.paperWidth);
    const targetWidth = spec.widthPx; // already multiple of 8 in RECEIPT_SPECS
    const scale = targetWidth / Math.max(1, source.width);
    const targetHeight = Math.max(8, Math.floor(source.height * scale));
    const heightAligned = targetHeight + ((8 - (targetHeight % 8)) % 8);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = heightAligned;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, heightAligned);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const imgData = ctx.getImageData(0, 0, targetWidth, heightAligned);
    const data = imgData.data;
    const bytesWidth = targetWidth / 8;
    const commands: number[] = [0x1b, 0x40];
    const xL = bytesWidth % 256;
    const xH = Math.floor(bytesWidth / 256);
    const yL = heightAligned % 256;
    const yH = Math.floor(heightAligned / 256);
    commands.push(0x1d, 0x76, 0x30, 0, xL, xH, yL, yH);

    for (let y = 0; y < heightAligned; y++) {
      for (let b = 0; b < bytesWidth; b++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const pixelX = b * 8 + bit;
          const pixelIdx = (y * targetWidth + pixelX) * 4;
          const gray =
            0.299 * data[pixelIdx] + 0.587 * data[pixelIdx + 1] + 0.114 * data[pixelIdx + 2];
          const isBlack = data[pixelIdx + 3] > 50 && gray < 128 ? 1 : 0;
          byteVal = (byteVal << 1) | isBlack;
        }
        commands.push(byteVal);
      }
    }
    commands.push(0x1d, 0x56, 0x42, 0x00);
    await this.writeEscPosData(new Uint8Array(commands));
  }

  private async printInvoiceShareImageRaster(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number }[],
    runningTotal: number,
    currency: string,
    attendantName?: string,
    layoutMode: ReceiptLayoutMode = 'full'
  ): Promise<boolean> {
    const result = await this.withBluetoothLock(async () => {
      const shareCanvas = renderInvoiceShareImage(
        {
          invoiceName,
          total: runningTotal.toFixed(2),
          currency,
          attendantName: attendantName ?? '',
          items: items.map((item, i) => ({
            name: item.name || `Item ${i + 1}`,
            price: item.price,
            quantity: item.quantity,
          })),
        },
        { layoutMode }
      );
      await this.sendCanvasAsGsV0(shareCanvas);
    });
    const ok = result !== null;
    logReceiptPrint(ok ? 'success' : 'failure', {
      mode: 'raster_share_image',
      invoiceName,
      paperWidth: this.paperWidth,
    });
    return ok;
  }

  async printInvoiceImage(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number }[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string,
    layoutMode: ReceiptLayoutMode = 'full'
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
    const itemHeight = spec.itemLineHeightPx;
    const headerHeight = attendantName ? spec.headerHeightPx : spec.headerHeightPx - 12;
    const footerHeight = spec.footerHeightPx;
    const itemRows = layoutMode === 'full' ? items.length : 0;
    const height = headerHeight + itemRows * itemHeight + footerHeight;

    logReceiptPrint('start', {
      mode: 'raster_image',
      invoiceName,
      paperWidth: this.paperWidth,
      canvas: { width, height },
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
      });
      await this.sendCanvasAsGsV0(canvas);
    });

    const ok = result !== null;
    if (ok) {
      logReceiptPrint('success', {
        mode: 'raster_image',
        invoiceName,
        paperWidth: this.paperWidth,
        canvas: { width, height },
        commandBytes: width / 8 * height + 12,
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

  /** Notepad slip as GS v 0 raster (visible on heads that ignore ESC/POS text). */
  async printNotepadImage(title: string, body: string, attendantName?: string): Promise<boolean> {
    return this.printNotepad(title, body, attendantName);
  }

  async printNotepad(title: string, body: string, attendantName?: string): Promise<boolean> {
    const spec = getReceiptSpec(this.paperWidth);
    const lines = body.split('\n').map((l) => l.trimEnd());
    const lineHeight = 22;
    const headerHeight = attendantName ? 72 : 52;
    const height = Math.min(
      spec.maxHeightPx,
      headerHeight + Math.max(1, lines.length) * lineHeight + 40
    );

    logReceiptPrint('start', {
      mode: 'raster_notepad',
      invoiceName: title,
      paperWidth: this.paperWidth,
      lineCount: lines.length,
    });

    const result = await this.withBluetoothLock(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = spec.widthPx;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create 2D canvas context');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.font = '700 18px monospace, sans-serif';
      ctx.fillText(truncateReceiptText(title.toUpperCase(), spec.maxInvoiceTitleChars), canvas.width / 2, 8);
      ctx.font = '400 12px monospace, sans-serif';
      if (attendantName) {
        ctx.fillText(formatServedByLine(attendantName, spec), canvas.width / 2, 32);
      }
      ctx.textAlign = 'left';
      ctx.font = '500 14px monospace, sans-serif';
      let y = attendantName ? 56 : 40;
      for (const line of lines) {
        for (const chunk of wrapReceiptLine(line, spec.maxCols)) {
          if (y + lineHeight > height - 16) break;
          ctx.fillText(chunk, 8, y);
          y += lineHeight;
        }
      }
      await this.sendCanvasAsGsV0(canvas);
    });

    const ok = result !== null;
    logReceiptPrint(ok ? 'success' : 'failure', {
      mode: 'raster_notepad',
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

/**
 * Formats, transports, and necessities for a successful print.
 *
 * Wire format (all transports):
 * - ESC/POS text: ESC @ init, ESC a align, ESC E bold, plain UTF-8 lines, GS V partial cut
 * - ESC/POS raster: ESC @ + GS v 0 bit-image (1-bit monochrome from canvas)
 *
 * Transports (auto-connect order):
 * 1. USB — WebUSB bulk OUT (class 7 / common thermal vendor IDs)
 * 2. Bluetooth LE — GATT write / write-without-response (native Capacitor or Web Bluetooth)
 * 3. WiFi / network — raw TCP port 9100 (native Android); best-effort HTTP in browser
 *
 * Classic Bluetooth SPP-only printers are not supported in-browser; use USB, WiFi (9100),
 * or a dual-mode BLE thermal printer / Android APK.
 */
export function getPrinterCapabilities() {
  const bt = getBluetoothSupport();
  const usb = getUsbSupport();
  const net = getNetworkPrinterSupport();

  return {
    formats: {
      text: {
        id: 'escpos_text',
        name: 'ESC/POS text',
        description:
          'Standard ESC/POS control codes + UTF-8 text lines. Works on classic and modern ESC/POS thermal printers.',
        commands: ['ESC @', 'ESC a', 'ESC E', 'GS V (cut)'],
      },
      raster: {
        id: 'raster_image',
        name: 'ESC/POS raster (GS v 0)',
        description:
          'Canvas rendered to 1-bit bitmap, sent as GS v 0. Used for invoices with logos/layout fidelity.',
        commands: ['ESC @', 'GS v 0', 'GS V (cut)'],
      },
    },
    transports: {
      usb: {
        order: 1,
        id: 'usb',
        available: usb.supported,
        protocol: 'ESC/POS over USB bulk OUT',
        message: usb.message,
      },
      ble: {
        order: 2,
        id: 'ble',
        available: bt.supported,
        protocol: 'ESC/POS over Bluetooth LE GATT',
        message: bt.message,
        note: 'Bluetooth Classic (SPP) only devices are not supported. Use BLE thermal printers.',
      },
      network: {
        order: 3,
        id: 'network',
        available: net.supported,
        protocol: 'ESC/POS over TCP raw (port 9100)',
        message: net.message,
        nativeTcp: net.nativeTcp,
      },
    },
    autoConnectOrder: ['usb', 'ble', 'network'] as const,
    paperWidths: ['58mm', '25mm'] as const,
    necessities: [
      'Printer powered on and awake (press feed if sleeping).',
      'Paper loaded; correct width auto-detected (58mm standard / 25mm mini).',
      'USB: cable connected; authorize once via Connect USB (Chrome/Edge or APK).',
      'Bluetooth: BLE thermal within 1–2 m; not exclusively paired to another phone; adapter on.',
      'WiFi: printer and device on the same network; correct IP; raw port 9100 open (best on Android APK).',
      'Secure context for browser APIs: HTTPS or http://localhost.',
      'Print path free (one job at a time on the BLE channel).',
    ],
    notes: [
      'Auto-scan while using the calculator tries USB, then Bluetooth, then saved WiFi printers — no picker dialogs.',
      'First-time pairing still needs Scan (Bluetooth) / Connect USB / enter WiFi IP once.',
      'Modern ESC/POS and older ESC/POS firmwares both accept the same command set used here.',
    ],
  };
}

export const printerInstance = new BLEPrinter();