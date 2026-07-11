// Web Bluetooth + WebUSB ESC/POS Printer Utility
import { storage } from '../hooks/storage';
import { getUsbSupport, UsbPrinterTransport, usbDeviceId, usbDeviceLabel } from './usbPrinter';
import icalcLogo from '../assets/logo/icalc-logo.png';
import {
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

export interface BLEDevice {
  id: string;
  name: string;
  device: BluetoothDevice;
}

export type PrinterTransport = 'ble' | 'usb';

export interface SavedPrinter {
  id: string;
  name: string;
  paperWidth: '58mm' | '25mm';
  lastConnected: number;
  transport?: PrinterTransport;
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
      message: 'Web Bluetooth is not available. Use Chrome or Edge on desktop/Android.',
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
  private usb = new UsbPrinterTransport();
  private connectionListeners = new Set<() => void>();
  private disconnectHandler: ((event: Event) => void) | null = null;
  private isBluetoothBusy = false;

  public paperWidth: PaperWidth = storage.get<PaperWidth>(DEFAULT_PAPER_WIDTH_KEY, '58mm');
  public transport: PrinterTransport = storage.get<PrinterTransport>(PRINTER_TRANSPORT_KEY, 'ble');

  get isConnected(): boolean {
    return this.transport === 'usb' ? this.usb.isConnected : this.bleConnected;
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
    return this.device?.id ?? null;
  }

  getConnectedDeviceName(): string | null {
    if (this.transport === 'usb') return this.usb.getConnectedDeviceName();
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

  private savePairedDevice(device: BluetoothDevice) {
    const saved = this.getSavedPrinters().filter((p) => p.id !== device.id);
    saved.unshift({
      id: device.id,
      name: device.name || 'Thermal Printer',
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
      transport: 'ble',
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 12));
  }

  private detectPaperWidthFromName(deviceName: string): PaperWidth | null {
    const lower = deviceName.toLowerCase();
    if (/\b25\b|25mm|2\.5\s*inch|micro|mini|label|narrow/.test(lower)) {
      return '25mm';
    }
    if (/\b57\b|57mm|\b58\b|58mm|80mm|standard/.test(lower)) {
      return '58mm';
    }
    return null;
  }

  private resolvePaperWidth(device: BluetoothDevice) {
    const saved = this.getSavedPrinters().find((p) => p.id === device.id);
    if (saved?.paperWidth) {
      this.paperWidth = saved.paperWidth;
      return;
    }

    const detected = this.detectPaperWidthFromName(device.name || '');
    if (detected) {
      this.paperWidth = detected;
      return;
    }

    this.paperWidth = storage.get<PaperWidth>(DEFAULT_PAPER_WIDTH_KEY, '58mm');
  }

  setPaperWidth(width: PaperWidth) {
    this.paperWidth = width;
    storage.set(DEFAULT_PAPER_WIDTH_KEY, width);

    const saved = this.getSavedPrinters();
    if (saved.length > 0) {
      storage.set(
        PAIRED_PRINTERS_KEY,
        saved.map((p) => ({ ...p, paperWidth: width }))
      );
    } else if (this.device?.id) {
      storage.set(PAIRED_PRINTERS_KEY, [
        {
          id: this.device.id,
          name: this.device.name || 'Thermal Printer',
          paperWidth: width,
          lastConnected: Date.now(),
        },
      ]);
    }

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
    this.resolvePaperWidth(device);
    this.attachDisconnectHandler(device);

    this.characteristic = await this.rediscoverServices(device);
    this.bleConnected = true;
    this.savePairedDevice(device);
    this.notifyConnectionChange();

    return device.name || 'Thermal Printer';
  }

  async getKnownPrinters(): Promise<KnownPrinter[]> {
    const saved = [...this.getSavedPrinters()];
    const authorizedBle = await this.getAuthorizedDevices();
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
      this.setTransport('ble');
      this.assertBluetoothAvailable();
      const device = await this.requestPrinterDevice();
      return await this.connectGATT(device);
    } catch (err: unknown) {
      this.bleConnected = false;
      if (!isUserCancelled(err)) {
        logPrinterFail('ble_scan_connect', err, { transport: 'ble' });
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
      const authorized = await this.getAuthorizedDevices();
      let device = authorized.find((d) => d.id === printerId);

      if (!device) {
        device = await this.requestPrinterDevice(saved?.name);
      }

      return await this.connectGATT(device);
    } catch (err: unknown) {
      this.bleConnected = false;
      if (!isUserCancelled(err)) {
        logPrinterFail('ble_connect_saved', err, { transport: 'ble', printerId });
      }
      throw normalizeBluetoothError(err);
    }
  }

  async reconnectIfNeeded(): Promise<void> {
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
    this.usb.disconnect();
    this.notifyConnectionChange();
  }

  private saveUsbDevice(name: string, id: string) {
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
      const characteristic = await this.getWriteCharacteristic();
      await this.writeDataInChunks(characteristic, data);
    } catch (err) {
      logPrinterFail('write_escpos', err, {
        transport: this.transport,
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
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    const rule = '-'.repeat(Math.floor(spec.maxCols * 0.95));
    let headerOffset = 10;

    try {
      const logo = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = icalcLogo;
      });
      if (logo) {
        const logoSize = Math.min(48, Math.floor(width * 0.22));
        const logoX = (width - logoSize) / 2;
        ctx.drawImage(logo, logoX, 8, logoSize, logoSize);
        headerOffset = 8 + logoSize + 6;
      }
    } catch {
      // logo optional for raster print
    }

    ctx.font = '700 20px Montserrat, Candara';
    ctx.textAlign = 'center';
    ctx.fillText(truncateReceiptText(invoiceName.toUpperCase(), spec.maxInvoiceTitleChars), width / 2, headerOffset);

    ctx.font = '300 12px Montserrat, Candara';
    ctx.fillText('iCalc Spatial POS Receipt', width / 2, headerOffset + 25);
    if (attendantName) {
      ctx.fillText(formatServedByLine(attendantName, spec), width / 2, headerOffset + 40);
    }

    ctx.font = '300 14px Montserrat, Candara';
    const ruleY = attendantName ? headerOffset + 58 : headerOffset + 48;
    ctx.fillText(rule, width / 2, ruleY);

    let currentY = ruleY + 17;

    if (layoutMode === 'full') {
      items.forEach((item, idx) => {
        const { displayName, priceText } = formatReceiptItemLine(
          item.name || `Item ${idx + 1}`,
          item.quantity,
          item.price,
          currency,
          spec
        );

        ctx.textAlign = 'left';
        ctx.font = '500 13px Montserrat, Candara';
        ctx.fillText(displayName, 8, currentY);

        ctx.textAlign = 'right';
        ctx.fillText(priceText, width - 8, currentY);

        currentY += itemHeight;
      });
    }

    ctx.textAlign = 'center';
    ctx.font = '300 14px Montserrat, Candara';
    ctx.fillText(rule, width / 2, currentY);
    currentY += 15;

    ctx.textAlign = 'right';
    ctx.font = '700 16px Montserrat, Candara';
    ctx.fillText(`TOTAL: ${currency}${runningTotal.toFixed(2)}`, width - 8, currentY);
    currentY += 25;

    ctx.textAlign = 'center';
    ctx.font = 'italic 300 12px Montserrat, Candara';
    ctx.fillText('Thank you for', width / 2, currentY);
    ctx.fillText('your purchase!', width / 2, currentY + 15);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const bytesWidth = width / 8;
    const commands: number[] = [];

    commands.push(0x1B, 0x40);

    const xL = bytesWidth % 256;
    const xH = Math.floor(bytesWidth / 256);
    const yL = height % 256;
    const yH = Math.floor(height / 256);

    commands.push(0x1D, 0x76, 0x30, 0, xL, xH, yL, yH);

    for (let y = 0; y < height; y++) {
      for (let b = 0; b < bytesWidth; b++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const pixelX = b * 8 + bit;
          const pixelIdx = (y * width + pixelX) * 4;

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