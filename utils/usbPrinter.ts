const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface UsbSupportInfo {
  supported: boolean;
  secureContext: boolean;
  message: string | null;
}

export const getUsbSupport = (): UsbSupportInfo => {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const hasApi = typeof navigator !== 'undefined' && 'usb' in navigator;

  if (!hasApi) {
    return {
      supported: false,
      secureContext,
      message: secureContext
        ? 'WebUSB is not available in this browser. Use Chrome or Edge on desktop.'
        : 'WebUSB requires HTTPS or localhost.',
    };
  }

  return { supported: true, secureContext, message: null };
};

/** Common USB thermal / ESC-POS vendor filters */
const USB_PRINTER_FILTERS: USBDeviceFilter[] = [
  { classCode: 7 },
  { vendorId: 0x0416 },
  { vendorId: 0x0483 },
  { vendorId: 0x04b8 },
  { vendorId: 0x154f },
  { vendorId: 0x1659 },
  { vendorId: 0x1fc9 },
  { vendorId: 0x6868 },
  { vendorId: 0x0fe6 },
  { vendorId: 0x0525 },
];

export const usbDeviceLabel = (device: USBDevice): string =>
  device.productName || `USB printer ${device.vendorId.toString(16)}:${device.productId.toString(16)}`;

export const usbDeviceId = (device: USBDevice): string =>
  `${device.vendorId}-${device.productId}-${device.serialNumber ?? 'default'}`;

export class UsbPrinterTransport {
  private device: USBDevice | null = null;
  private outEndpoint: number | null = null;

  get isConnected(): boolean {
    return !!this.device?.opened;
  }

  getConnectedDeviceId(): string | null {
    return this.device ? usbDeviceId(this.device) : null;
  }

  getConnectedDeviceName(): string | null {
    return this.device ? usbDeviceLabel(this.device) : null;
  }

  async getAuthorizedDevices(): Promise<USBDevice[]> {
    if (!navigator.usb?.getDevices) return [];
    try {
      return await navigator.usb.getDevices();
    } catch {
      return [];
    }
  }

  private findBulkOutEndpoint(device: USBDevice): number {
    const config = device.configuration;
    if (!config) throw new Error('USB printer has no active configuration.');

    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        const isPrinterClass = alt.interfaceClass === 7 || alt.interfaceClass === 255;
        const outEp = alt.endpoints.find((ep) => ep.direction === 'out' && ep.type === 'bulk');
        if (outEp && (isPrinterClass || alt.endpoints.length <= 2)) {
          return outEp.endpointNumber;
        }
      }
    }

    throw new Error('No USB bulk OUT endpoint found on this printer.');
  }

  private async openDevice(device: USBDevice): Promise<void> {
    if (!device.opened) await device.open();

    if (!device.configuration) {
      const config = device.configurations[0];
      if (!config) throw new Error('USB printer has no configuration.');
      await device.selectConfiguration(config.configurationValue);
    }

    const config = device.configuration!;
    let claimed = false;

    for (const iface of config.interfaces) {
      try {
        await device.claimInterface(iface.interfaceNumber);
        this.outEndpoint = this.findBulkOutEndpoint(device);
        claimed = true;
        break;
      } catch {
        try {
          await device.releaseInterface(iface.interfaceNumber);
        } catch {
          // ignore
        }
      }
    }

    if (!claimed || this.outEndpoint === null) {
      throw new Error('Could not claim a USB interface on this printer.');
    }

    this.device = device;
  }

  async requestAndConnect(): Promise<string> {
    const support = getUsbSupport();
    if (!support.supported) throw new Error(support.message ?? 'WebUSB not supported.');

    const device = await navigator.usb!.requestDevice({ filters: USB_PRINTER_FILTERS });
    await this.openDevice(device);
    return usbDeviceLabel(device);
  }

  async connectToId(deviceId: string): Promise<string> {
    const authorized = await this.getAuthorizedDevices();
    const device = authorized.find((d) => usbDeviceId(d) === deviceId);
    if (!device) throw new Error('USB printer not authorized. Connect via USB first.');
    await this.openDevice(device);
    return usbDeviceLabel(device);
  }

  async ensureConnected(savedIds: string[]): Promise<boolean> {
    if (this.isConnected) return true;
    const authorized = await this.getAuthorizedDevices();
    for (const id of savedIds) {
      const device = authorized.find((d) => usbDeviceId(d) === id);
      if (device) {
        try {
          await this.openDevice(device);
          return true;
        } catch {
          // try next
        }
      }
    }
    const any = authorized[0];
    if (any) {
      try {
        await this.openDevice(any);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  disconnect(): void {
    if (this.device?.opened) {
      try {
        void this.device.close();
      } catch {
        // ignore
      }
    }
    this.device = null;
    this.outEndpoint = null;
  }

  async writeInChunks(data: Uint8Array): Promise<void> {
    if (!this.device?.opened || this.outEndpoint === null) {
      throw new Error('USB printer is not connected.');
    }

    const chunkSize = 512;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const result = await this.device.transferOut(this.outEndpoint, chunk);
      if (result.status !== 'ok') {
        throw new Error(`USB transfer failed: ${result.status}`);
      }
      await delay(12);
    }
  }
}