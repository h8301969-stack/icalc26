// Web Bluetooth ESC/POS Printer Utility

export interface BLEDevice {
  id: string;
  name: string;
  device: BluetoothDevice;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export class BLEPrinter {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  // Custom configuration
  public paperWidth: '58mm' | '25mm' = '58mm';
  public isConnected: boolean = false;

  // Standard raw printer service & write characteristic UUIDs
  private serviceUUID = '000018f0-0000-1000-8000-00805f9b34fb';
  private charUUID = '00002af1-0000-1000-8000-00805f9b34fb';

  async scanAndConnect(): Promise<string> {
    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this browser.');
      }

      // Request any bluetooth device that advertises raw printing service or has printer in name
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [this.serviceUUID]
      });

      this.device = device;
      
      // Auto-detect paper size from device name
      const deviceName = device.name?.toLowerCase() || '';
      if (deviceName.includes('25') || deviceName.includes('micro') || deviceName.includes('label')) {
        this.paperWidth = '25mm';
      } else {
        this.paperWidth = '58mm';
      }

      // Connect to GATT server
      const server = await device.gatt?.connect();
      if (!server) throw new Error('Could not connect to GATT Server');
      this.server = server;

      // Get primary service
      let service;
      try {
        service = await server.getPrimaryService(this.serviceUUID);
      } catch {
        // Fallback: try standard serial service or get all services
        const services = await server.getPrimaryServices();
        if (services.length > 0) {
          service = services[0];
        } else {
          throw new Error('No compatible primary services found.');
        }
      }

      // Get write characteristic
      const characteristics = await service.getCharacteristics();
      const writeChar = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (!writeChar) {
        throw new Error('No write characteristic found on printer.');
      }
      this.characteristic = writeChar;
      this.isConnected = true;

      return device.name || 'Thermal Printer';
    } catch (err: unknown) {
      this.isConnected = false;
      throw err;
    }
  }

  disconnect() {
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;
  }

  async printInvoice(invoiceName: string, items: CartItem[], runningTotal: number, currency: string = '¢'): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Printer is not connected.');
    }

    const encoder = new TextEncoder();
    const commands: number[] = [];

    // ESC/POS Commands:
    // Initialize printer
    commands.push(0x1B, 0x40);

    // Center alignment
    commands.push(0x1B, 0x61, 0x01);

    // Bold title
    commands.push(0x1B, 0x45, 0x01);
    const title = `${invoiceName.toUpperCase()}\n`;
    commands.push(...Array.from(encoder.encode(title)));
    
    // Normal text
    commands.push(0x1B, 0x45, 0x00);
    const subTitle = `iCalc Spatial POS Receipt\n`;
    commands.push(...Array.from(encoder.encode(subTitle)));
    commands.push(...Array.from(encoder.encode(`Width: ${this.paperWidth} (Auto)\n`)));
    commands.push(...Array.from(encoder.encode('--------------------------------\n')));

    // Left alignment for items
    commands.push(0x1B, 0x61, 0x00);

    // Character column counts based on paper size
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

    // Bold Total
    commands.push(0x1B, 0x45, 0x01);
    const totalText = `TOTAL: ${currency}${runningTotal.toFixed(2)}`;
    commands.push(...Array.from(encoder.encode(totalText + '\n')));
    commands.push(0x1B, 0x45, 0x00);

    // Footer
    commands.push(0x1B, 0x61, 0x01); // Center
    commands.push(...Array.from(encoder.encode('\nThank you for your purchase!\n\n\n')));

    // Paper feed & cut (GS V 66)
    commands.push(0x1D, 0x56, 0x42, 0x00);

    // Convert commands to Uint8Array and send in chunks of 20 bytes (BLE MTU limits)
    const data = new Uint8Array(commands);
    const chunkSize = 20;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      await this.characteristic.writeValue(chunk);
      // Brief sleep to avoid overloading printer buffer
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

    // Create an offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');

    // Fill white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Draw text in black
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    // 1. Header (Title)
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(invoiceName.toUpperCase(), width / 2, 10);

    // Subtitle
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('iCalc Spatial POS Receipt', width / 2, 35);
    ctx.fillText(`Width: ${this.paperWidth} (Image)`, width / 2, 50);

    // Divider
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('-'.repeat(width === 192 ? 20 : 40), width / 2, 68);

    // 2. Items
    let currentY = 85;
    const maxTextLen = width === 192 ? 12 : 24;

    items.forEach(item => {
      const name = item.name || 'Item';
      const displayName = name.length > maxTextLen ? name.substring(0, maxTextLen - 3) + '...' : name;
      const priceText = `${item.quantity}x ${currency}${item.price.toFixed(2)}`;

      // Draw item name on left
      ctx.textAlign = 'left';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(displayName, 8, currentY);

      // Draw price on right
      ctx.textAlign = 'right';
      ctx.fillText(priceText, width - 8, currentY);

      currentY += itemHeight;
    });

    // Divider
    ctx.textAlign = 'center';
    ctx.font = '14px "Courier New", monospace';
    ctx.fillText('-'.repeat(width === 192 ? 20 : 40), width / 2, currentY);
    currentY += 15;

    // 3. Total
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(`TOTAL: ${currency}${runningTotal.toFixed(2)}`, width - 8, currentY);
    currentY += 25;

    // 4. Footer
    ctx.textAlign = 'center';
    ctx.font = 'italic 12px "Courier New", monospace';
    ctx.fillText('Thank you for', width / 2, currentY);
    ctx.fillText('your purchase!', width / 2, currentY + 15);

    // Extract pixel data
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const bytesWidth = width / 8;
    const commands: number[] = [];

    // Initialize printer
    commands.push(0x1B, 0x40);

    // Image command header: GS v 0 m xL xH yL yH
    const xL = bytesWidth % 256;
    const xH = Math.floor(bytesWidth / 256);
    const yL = height % 256;
    const yH = Math.floor(height / 256);

    commands.push(0x1D, 0x76, 0x30, 0, xL, xH, yL, yH);

    // Pack pixels into bytes
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

    // Feed paper & cut
    commands.push(0x1D, 0x56, 0x42, 0x00);

    // Write in chunks
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

