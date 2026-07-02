// Web Bluetooth ESC/POS Printer Utility
import { storage } from '../hooks/storage';

export interface BLEDevice {
  id: string;
  name: string;
  device: BluetoothDevice;
}

export interface SavedPrinter {
  id: string;
  name: string;
  paperWidth: '58mm' | '25mm';
  lastConnected: number;
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

const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  return { supported: true, secureContext, message: null };
}

export class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onConnectionChange: (() => void) | null = null;
  private disconnectHandler: ((event: Event) => void) | null = null;
  private isBluetoothBusy = false;

  public paperWidth: '58mm' | '25mm' = '58mm';
  public isConnected: boolean = false;

  private serviceUUID = PRINTER_SERVICE_UUIDS[0];
  private charUUID = '00002af1-0000-1000-8000-00805f9b34fb';

  setConnectionChangeListener(listener: (() => void) | null) {
    this.onConnectionChange = listener;
  }

  getConnectedDeviceId(): string | null {
    return this.device?.id ?? null;
  }

  getConnectedDeviceName(): string | null {
    return this.device?.name ?? null;
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
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 12));
  }

  private detectPaperWidth(deviceName: string) {
    const lower = deviceName.toLowerCase();
    if (/\b25\b|25mm|2\.5\s*inch|micro|mini|label|narrow/.test(lower)) {
      this.paperWidth = '25mm';
    } else {
      // 58mm, 80mm, and unknown thermal printers default to standard width
      this.paperWidth = '58mm';
    }
  }

  private applySavedPaperWidth(deviceId: string) {
    const saved = this.getSavedPrinters().find((p) => p.id === deviceId);
    if (saved?.paperWidth) {
      this.paperWidth = saved.paperWidth;
    }
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
      this.isConnected = false;
      this.server = null;
      this.characteristic = null;
      this.onConnectionChange?.();
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

  private async connectGattServer(device: BluetoothDevice, attempt = 1): Promise<BluetoothRemoteGATTServer> {
    if (!device.gatt) {
      throw new Error('Bluetooth GATT is not available on this device.');
    }

    if (this.device && this.device.id !== device.id) {
      try {
        if (this.device.gatt.connected) this.device.gatt.disconnect();
      } catch {
        // ignore stale disconnect errors
      }
      this.server = null;
      this.characteristic = null;
      this.isConnected = false;
    }

    try {
      if (!device.gatt.connected) {
        await device.gatt.connect();
      }
    } catch (err) {
      if (attempt < 4) {
        await delay(350 * attempt);
        return this.connectGattServer(device, attempt + 1);
      }
      throw err instanceof Error ? err : new Error('Could not connect to GATT server.');
    }

    const server = device.gatt;
    if (!server.connected) {
      if (attempt < 4) {
        await delay(350 * attempt);
        return this.connectGattServer(device, attempt + 1);
      }
      throw new Error('GATT server disconnected. Turn the printer on and try again.');
    }

    return server;
  }

  private async rediscoverServices(
    server: BluetoothRemoteGATTServer,
    device: BluetoothDevice,
    attempt = 1
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    try {
      if (!server.connected || !device.gatt?.connected) {
        await this.connectGattServer(device);
      }

      let service: BluetoothRemoteGATTService | undefined;
      try {
        service = await server.getPrimaryService(this.serviceUUID);
      } catch {
        if (!server.connected) {
          await device.gatt!.connect();
        }
        const services = await server.getPrimaryServices();
        service =
          services.find((s) =>
            PRINTER_SERVICE_UUIDS.some((uuid) => s.uuid.toLowerCase() === uuid.toLowerCase())
          ) ?? services[0];
        if (!service) throw new Error('No compatible primary services found.');
      }

      const characteristics = await service.getCharacteristics();
      const writeChar =
        characteristics.find((c) => c.uuid.toLowerCase() === this.charUUID.toLowerCase()) ??
        characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse);

      if (!writeChar) {
        throw new Error('No write characteristic found on printer.');
      }

      return writeChar;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      const retriable =
        message.includes('disconnected') ||
        message.includes('GATT') ||
        message.includes('retrieve services');

      if (retriable && attempt < 4) {
        await delay(400 * attempt);
        await this.connectGattServer(device, attempt);
        return this.rediscoverServices(device.gatt!, device, attempt + 1);
      }
      throw err;
    }
  }

  private async connectGATT(device: BluetoothDevice): Promise<string> {
    this.assertBluetoothAvailable();

    this.device = device;
    this.applySavedPaperWidth(device.id);
    this.detectPaperWidth(device.name || '');
    this.attachDisconnectHandler(device);

    const server = await this.connectGattServer(device);
    this.server = server;
    this.characteristic = await this.rediscoverServices(server, device);
    this.isConnected = true;
    this.savePairedDevice(device);
    this.onConnectionChange?.();

    return device.name || 'Thermal Printer';
  }

  async getKnownPrinters(): Promise<KnownPrinter[]> {
    const saved = [...this.getSavedPrinters()];
    const authorized = await this.getAuthorizedDevices();
    const connectedId = this.getConnectedDeviceId();
    const merged = new Map<string, SavedPrinter>();

    for (const entry of saved) {
      merged.set(entry.id, entry);
    }

    for (const device of authorized) {
      const existing = merged.get(device.id);
      merged.set(device.id, {
        id: device.id,
        name: device.name || existing?.name || 'Thermal Printer',
        paperWidth: existing?.paperWidth ?? this.paperWidth,
        lastConnected: existing?.lastConnected ?? 0,
      });
    }

    const list = [...merged.values()].sort((a, b) => {
      if (a.id === connectedId) return -1;
      if (b.id === connectedId) return 1;
      return b.lastConnected - a.lastConnected;
    });

    return list.map((entry) => {
      const device = authorized.find((d) => d.id === entry.id) ?? null;
      const gattConnected = device?.gatt?.connected ?? false;
      const isConnected =
        entry.id === connectedId && (this.isConnected || gattConnected);

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
      this.assertBluetoothAvailable();

      const device = await navigator.bluetooth!.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS,
      });

      return await this.connectGATT(device);
    } catch (err: unknown) {
      this.isConnected = false;
      throw err;
    }
  }

  async connectToSavedPrinter(printerId: string): Promise<string> {
    this.assertBluetoothAvailable();

    const authorized = await this.getAuthorizedDevices();
    let device = authorized.find((d) => d.id === printerId);

    if (!device) {
      const saved = this.getSavedPrinters().find((p) => p.id === printerId);
      device = await navigator.bluetooth!.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS,
      });

      if (saved && device.id !== printerId) {
        // User chose a different device in the picker — still connect it.
      }
    }

    return await this.connectGATT(device);
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
      const saved = [...this.getSavedPrinters()].sort(
        (a, b) => b.lastConnected - a.lastConnected
      );

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
      console.warn('Auto printer connect failed:', err);
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
    this.isConnected = false;
    this.onConnectionChange?.();
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
      console.warn('Bluetooth is busy. Ignoring request.');
      return null;
    }

    try {
      this.isBluetoothBusy = true;
      return await operation();
    } catch (error) {
      console.error('BLE Error:', error);
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
      if (characteristic.properties.write) {
        await characteristic.writeValueWithResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      await delay(30);
    }
  }

  async printInvoice(
    invoiceName: string,
    items: CartItem[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string
  ): Promise<boolean> {
    const result = await this.withBluetoothLock(async () => {
    const characteristic = await this.getWriteCharacteristic();

    const encoder = new TextEncoder();
    const commands: number[] = [];

    commands.push(0x1B, 0x40);
    commands.push(0x1B, 0x61, 0x01);
    commands.push(0x1B, 0x45, 0x01);
    const title = `${invoiceName.toUpperCase()}\n`;
    commands.push(...Array.from(encoder.encode(title)));

    commands.push(0x1B, 0x45, 0x00);
    const subTitle = `iCalc Spatial POS Receipt\n`;
    commands.push(...Array.from(encoder.encode(subTitle)));
    if (attendantName) {
      commands.push(...Array.from(encoder.encode(`Served by: ${attendantName}\n`)));
    }
    commands.push(...Array.from(encoder.encode('--------------------------------\n')));

    commands.push(0x1B, 0x61, 0x00);

    const maxCols = this.paperWidth === '25mm' ? 16 : 32;

    items.forEach(item => {
      const priceText = `${item.quantity}x ${currency}${item.price.toFixed(2)}`;
      const nameText = item.name.substring(0, maxCols - priceText.length - 1);
      const spacesCount = maxCols - nameText.length - priceText.length;
      const spaces = ' '.repeat(spacesCount > 0 ? spacesCount : 1);

      const line = `${nameText}${spaces}${priceText}\n`;
      commands.push(...Array.from(encoder.encode(line)));
    });

    commands.push(...Array.from(encoder.encode('--------------------------------\n')));

    commands.push(0x1B, 0x45, 0x01);
    const totalText = `TOTAL: ${currency}${runningTotal.toFixed(2)}`;
    commands.push(...Array.from(encoder.encode(totalText + '\n')));
    commands.push(0x1B, 0x45, 0x00);

    commands.push(0x1B, 0x61, 0x01);
    commands.push(...Array.from(encoder.encode('\nThank you for your purchase!\n\n\n')));

    commands.push(0x1D, 0x56, 0x42, 0x00);

    const data = new Uint8Array(commands);
    await this.writeDataInChunks(characteristic, data);
    });
    return result !== null;
  }

  async printInvoiceImage(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number }[],
    runningTotal: number,
    currency: string = '¢',
    attendantName?: string
  ): Promise<boolean> {
    const result = await this.withBluetoothLock(async () => {
    const characteristic = await this.getWriteCharacteristic();

    const width = this.paperWidth === '25mm' ? 192 : 384;
    const itemHeight = 24;
    const headerHeight = attendantName ? 100 : 88;
    const footerHeight = 80;
    const height = headerHeight + (items.length * itemHeight) + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(invoiceName.toUpperCase(), width / 2, 10);

    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('iCalc Spatial POS Receipt', width / 2, 35);
    if (attendantName) {
      ctx.fillText(`Served by: ${attendantName}`, width / 2, 50);
    }

    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('-'.repeat(width === 192 ? 20 : 40), width / 2, attendantName ? 68 : 68);

    let currentY = attendantName ? 85 : 85;
    const maxTextLen = width === 192 ? 12 : 24;

    items.forEach(item => {
      const name = item.name || 'Item';
      const displayName = name.length > maxTextLen ? name.substring(0, maxTextLen - 3) + '...' : name;
      const priceText = `${item.quantity}x ${currency}${item.price.toFixed(2)}`;

      ctx.textAlign = 'left';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(displayName, 8, currentY);

      ctx.textAlign = 'right';
      ctx.fillText(priceText, width - 8, currentY);

      currentY += itemHeight;
    });

    ctx.textAlign = 'center';
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('-'.repeat(width === 192 ? 20 : 40), width / 2, currentY);
    currentY += 15;

    ctx.textAlign = 'right';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(`TOTAL: ${currency}${runningTotal.toFixed(2)}`, width - 8, currentY);
    currentY += 25;

    ctx.textAlign = 'center';
    ctx.font = 'italic 12px "Courier New", monospace';
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
    await this.writeDataInChunks(characteristic, printData);
    });
    return result !== null;
  }
}

export const printerInstance = new BLEPrinter();