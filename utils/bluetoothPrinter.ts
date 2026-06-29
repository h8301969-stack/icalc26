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

export interface KnownPrinter {
  saved: SavedPrinter;
  device: BluetoothDevice | null;
  isConnected: boolean;
  isAuthorized: boolean;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const PAIRED_PRINTERS_KEY = 'ble_paired_printers';

const PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

export class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onConnectionChange: (() => void) | null = null;

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

  private savePairedDevice(device: BluetoothDevice) {
    const saved = this.getSavedPrinters().filter((p) => p.id !== device.id);
    saved.unshift({
      id: device.id,
      name: device.name || 'Thermal Printer',
      paperWidth: this.paperWidth,
      lastConnected: Date.now(),
    });
    storage.set(PAIRED_PRINTERS_KEY, saved.slice(0, 8));
  }

  private detectPaperWidth(deviceName: string) {
    const lower = deviceName.toLowerCase();
    if (lower.includes('25') || lower.includes('micro') || lower.includes('label')) {
      this.paperWidth = '25mm';
    } else {
      this.paperWidth = '58mm';
    }
  }

  private attachDisconnectHandler(device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => {
      this.isConnected = false;
      this.server = null;
      this.characteristic = null;
      this.onConnectionChange?.();
    });
  }

  private async connectGATT(device: BluetoothDevice): Promise<string> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser.');
    }

    this.device = device;
    this.detectPaperWidth(device.name || '');
    this.attachDisconnectHandler(device);

    const server = await device.gatt?.connect();
    if (!server) throw new Error('Could not connect to GATT Server');
    this.server = server;

    let service: BluetoothRemoteGATTService | undefined;
    try {
      service = await server.getPrimaryService(this.serviceUUID);
    } catch {
      const services = await server.getPrimaryServices();
      service = services[0];
      if (!service) throw new Error('No compatible primary services found.');
    }

    const characteristics = await service.getCharacteristics();
    const writeChar = characteristics.find(
      (c) => c.properties.write || c.properties.writeWithoutResponse
    );
    if (!writeChar) {
      throw new Error('No write characteristic found on printer.');
    }

    this.characteristic = writeChar;
    this.isConnected = true;
    this.savePairedDevice(device);
    this.onConnectionChange?.();

    return device.name || 'Thermal Printer';
  }

  async getKnownPrinters(): Promise<KnownPrinter[]> {
    const saved = this.getSavedPrinters();
    let authorized: BluetoothDevice[] = [];

    if (navigator.bluetooth?.getDevices) {
      try {
        authorized = await navigator.bluetooth.getDevices();
      } catch {
        authorized = [];
      }
    }

    const knownIds = new Set(saved.map((p) => p.id));
    for (const device of authorized) {
      if (!knownIds.has(device.id)) {
        saved.unshift({
          id: device.id,
          name: device.name || 'Thermal Printer',
          paperWidth: this.paperWidth,
          lastConnected: 0,
        });
        knownIds.add(device.id);
      }
    }

    return saved.map((entry) => {
      const device = authorized.find((d) => d.id === entry.id) ?? null;
      const isConnected =
        (this.device?.id === entry.id && this.isConnected) ||
        (device?.gatt?.connected ?? false);
      return {
        saved: entry,
        device,
        isConnected,
        isAuthorized: device !== null,
      };
    });
  }

  async scanAndConnect(): Promise<string> {
    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this browser.');
      }

      const device = await navigator.bluetooth.requestDevice({
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
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser.');
    }

    let device: BluetoothDevice | undefined;

    if (navigator.bluetooth.getDevices) {
      const authorized = await navigator.bluetooth.getDevices();
      device = authorized.find((d) => d.id === printerId);
    }

    if (!device) {
      const saved = this.getSavedPrinters().find((p) => p.id === printerId);
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICE_UUIDS,
      });
      if (device.id !== printerId && saved) {
        // User picked a different device — still connect and save it
      }
    }

    return await this.connectGATT(device);
  }

  disconnect() {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;
    this.onConnectionChange?.();
  }

  async printInvoice(invoiceName: string, items: CartItem[], runningTotal: number, currency: string = '¢'): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Printer is not connected.');
    }

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
    commands.push(...Array.from(encoder.encode(`Width: ${this.paperWidth} (Auto)\n`)));
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
    const chunkSize = 20;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      await this.characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }

  async printInvoiceImage(
    invoiceName: string,
    items: { name?: string; price: number; quantity: number }[],
    runningTotal: number,
    currency: string = '¢'
  ): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Printer is not connected.');
    }

    const width = this.paperWidth === '25mm' ? 192 : 384;
    const itemHeight = 24;
    const headerHeight = 90;
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
    ctx.fillText(`Width: ${this.paperWidth} (Image)`, width / 2, 50);

    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('-'.repeat(width === 192 ? 20 : 40), width / 2, 68);

    let currentY = 85;
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
    const chunkSize = 20;
    for (let i = 0; i < printData.length; i += chunkSize) {
      const chunk = printData.slice(i, i + chunkSize);
      await this.characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
}

export const printerInstance = new BLEPrinter();