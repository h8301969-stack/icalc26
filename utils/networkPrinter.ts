/**
 * WiFi / network ESC/POS printers (raw TCP port 9100, JetDirect-style).
 * - Capacitor Android: native TCP socket plugin (EscPosNetwork)
 * - Browser: best-effort HTTP POST to host:port (many firmwares reject this; use APK for reliable WiFi)
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { storage } from '../hooks/storage';

const NETWORK_PRINTERS_KEY = 'network_escpos_printers';
const ACTIVE_NETWORK_PRINTER_KEY = 'network_escpos_active_id';
const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 4000;

export interface NetworkPrinterConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  lastConnected: number;
}

export interface NetworkSupportInfo {
  supported: boolean;
  nativeTcp: boolean;
  message: string | null;
}

interface EscPosNetworkPlugin {
  testConnection(options: { host: string; port: number; timeoutMs?: number }): Promise<{ ok: boolean }>;
  print(options: {
    host: string;
    port: number;
    dataBase64: string;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; bytesWritten?: number }>;
}

const EscPosNetwork = registerPlugin<EscPosNetworkPlugin>('EscPosNetwork');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNativePlatform = () => Capacitor.isNativePlatform();

export function getNetworkPrinterSupport(): NetworkSupportInfo {
  if (isNativePlatform()) {
    return {
      supported: true,
      nativeTcp: true,
      message:
        'WiFi / network thermal printers: enter the printer IP (same WiFi as this device). Uses raw ESC/POS on port 9100.',
    };
  }

  return {
    supported: true,
    nativeTcp: false,
    message:
      'WiFi thermal printing works most reliably in the Android APK (raw TCP 9100). In the browser, only some HTTP-capable printers accept jobs.',
  };
}

export function normalizeHost(host: string): string {
  return host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').split(':')[0] ?? '';
}

export function makeNetworkPrinterId(host: string, port: number): string {
  return `net:${normalizeHost(host)}:${port || DEFAULT_PORT}`;
}

export function getSavedNetworkPrinters(): NetworkPrinterConfig[] {
  return storage.get<NetworkPrinterConfig[]>(NETWORK_PRINTERS_KEY, []);
}

export function saveNetworkPrinter(config: Omit<NetworkPrinterConfig, 'id' | 'lastConnected'> & { id?: string }): NetworkPrinterConfig {
  const host = normalizeHost(config.host);
  const port = config.port > 0 ? config.port : DEFAULT_PORT;
  const id = config.id ?? makeNetworkPrinterId(host, port);
  const entry: NetworkPrinterConfig = {
    id,
    name: config.name.trim() || `WiFi Printer ${host}`,
    host,
    port,
    lastConnected: Date.now(),
  };
  const rest = getSavedNetworkPrinters().filter((p) => p.id !== id);
  storage.set(NETWORK_PRINTERS_KEY, [entry, ...rest].slice(0, 12));
  storage.set(ACTIVE_NETWORK_PRINTER_KEY, id);
  return entry;
}

export function getActiveNetworkPrinter(): NetworkPrinterConfig | null {
  const id = storage.get<string | null>(ACTIVE_NETWORK_PRINTER_KEY, null);
  const all = getSavedNetworkPrinters();
  if (id) {
    const match = all.find((p) => p.id === id);
    if (match) return match;
  }
  return all[0] ?? null;
}

export function setActiveNetworkPrinter(id: string): void {
  storage.set(ACTIVE_NETWORK_PRINTER_KEY, id);
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function nativeTestConnection(host: string, port: number): Promise<boolean> {
  try {
    const result = await EscPosNetwork.testConnection({
      host,
      port,
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    return !!result?.ok;
  } catch {
    return false;
  }
}

async function nativeWrite(host: string, port: number, data: Uint8Array): Promise<void> {
  const result = await EscPosNetwork.print({
    host,
    port,
    dataBase64: toBase64(data),
    timeoutMs: 15000,
  });
  if (!result?.ok) {
    throw new Error('Network printer did not accept the print job.');
  }
}

/** Best-effort browser path: some gateways accept raw POST on 9100 /print. */
async function webWrite(host: string, port: number, data: Uint8Array): Promise<void> {
  const urls = [
    `http://${host}:${port}/`,
    `http://${host}:${port}/print`,
    `http://${host}:${port}/cgi-bin/epos/service.cgi`,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
      const response = await fetch(url, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'application/octet-stream' },
        mode: 'no-cors',
        signal: controller.signal,
      });
      clearTimeout(timer);
      // no-cors → opaque response; treat as attempted success
      void response;
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('Could not reach WiFi printer from this browser.');
}

export class NetworkPrinterTransport {
  private active: NetworkPrinterConfig | null = getActiveNetworkPrinter();
  private connected = false;

  get isConnected(): boolean {
    return this.connected && !!this.active;
  }

  getConnectedDeviceId(): string | null {
    return this.isConnected ? this.active!.id : null;
  }

  getConnectedDeviceName(): string | null {
    return this.isConnected ? this.active!.name : null;
  }

  getActiveConfig(): NetworkPrinterConfig | null {
    return this.active;
  }

  listSaved(): NetworkPrinterConfig[] {
    return getSavedNetworkPrinters();
  }

  disconnect(): void {
    this.connected = false;
  }

  async connect(config: { host: string; port?: number; name?: string }): Promise<string> {
    const host = normalizeHost(config.host);
    if (!host) throw new Error('Enter a WiFi printer IP address (e.g. 192.168.1.50).');

    const port = config.port && config.port > 0 ? config.port : DEFAULT_PORT;
    const name = config.name?.trim() || `WiFi Printer ${host}`;

    if (isNativePlatform()) {
      const ok = await nativeTestConnection(host, port);
      if (!ok) {
        throw new Error(
          `Could not reach ${host}:${port}. Put the printer on the same WiFi, confirm the IP, and ensure raw port ${port} is open.`
        );
      }
    } else {
      // Browser cannot open raw TCP; mark configured and attempt at print time
      await delay(50);
    }

    this.active = saveNetworkPrinter({ host, port, name });
    this.connected = true;
    return this.active.name;
  }

  async connectToId(id: string): Promise<string> {
    const saved = getSavedNetworkPrinters().find((p) => p.id === id);
    if (!saved) throw new Error('Saved WiFi printer not found.');
    return this.connect(saved);
  }

  async ensureConnected(preferredIds: string[] = []): Promise<boolean> {
    if (this.isConnected && this.active) {
      if (!isNativePlatform()) return true;
      const ok = await nativeTestConnection(this.active.host, this.active.port);
      if (ok) return true;
      this.connected = false;
    }

    const candidates: NetworkPrinterConfig[] = [];
    const saved = getSavedNetworkPrinters().sort((a, b) => b.lastConnected - a.lastConnected);

    for (const id of preferredIds) {
      const match = saved.find((p) => p.id === id);
      if (match) candidates.push(match);
    }
    for (const entry of saved) {
      if (!candidates.some((c) => c.id === entry.id)) candidates.push(entry);
    }

    for (const entry of candidates) {
      try {
        await this.connect(entry);
        return true;
      } catch {
        // try next
      }
    }
    return false;
  }

  async writeInChunks(data: Uint8Array): Promise<void> {
    if (!this.active) {
      throw new Error('No WiFi printer selected. Add a printer IP first.');
    }

    const { host, port } = this.active;

    if (isNativePlatform()) {
      await nativeWrite(host, port, data);
    } else {
      await webWrite(host, port, data);
    }

    this.connected = true;
    this.active = saveNetworkPrinter(this.active);
  }
}
