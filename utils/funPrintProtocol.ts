/**
 * Fun Print / C-series pocket printer protocol (C9, C15, MX06, MXW01, …).
 *
 * Detected from BLE service/characteristic UUIDs — never from the Bluetooth name,
 * so mixed customer printers (Fun Print pocket + ESC/POS receipt) both work.
 *
 * Two dialects share service 0xAE30:
 *   - cat (0x51 0x78): GB/MX06-style, scanlines on AE01
 *   - mxw01 (0x22 0x21): newer C9, control on AE01, image bulk on AE03
 */

export type BlePrintDialect = 'escpos' | 'funprint_cat' | 'funprint_mxw01';

export const FUN_PRINT_WIDTH_DOTS = 384;
export const FUN_PRINT_BYTES_PER_ROW = FUN_PRINT_WIDTH_DOTS / 8;
export const MXW01_MIN_IMAGE_BYTES = 4320; // 90 lines × 48 bytes

export const FUN_PRINT_SERVICE_UUIDS = [
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '0000ae3a-0000-1000-8000-00805f9b34fb',
];

export const FUN_PRINT_CONTROL_CHAR_UUIDS = [
  '0000ae01-0000-1000-8000-00805f9b34fb',
  '0000ae10-0000-1000-8000-00805f9b34fb',
];

export const FUN_PRINT_NOTIFY_CHAR_UUID = '0000ae02-0000-1000-8000-00805f9b34fb';
export const FUN_PRINT_DATA_CHAR_UUID = '0000ae03-0000-1000-8000-00805f9b34fb';

const uuidKey = (u: string) => u.replace(/-/g, '').toLowerCase();

export const isFunPrintServiceUuid = (uuid: string): boolean =>
  FUN_PRINT_SERVICE_UUIDS.some((known) => uuidKey(known) === uuidKey(uuid));

export const uuidEquals = (a: string, b: string): boolean => uuidKey(a) === uuidKey(b);

/** CRC-8 Dallas/Maxim (poly 0x07, init 0) — used by both cat and MXW01 payloads. */
export function crc8Dallas(data: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

export function funPrintPacket(preamble: [number, number], command: number, payload: ArrayLike<number>): Uint8Array {
  const len = payload.length;
  const out = new Uint8Array(8 + len);
  out[0] = preamble[0];
  out[1] = preamble[1];
  out[2] = command & 0xff;
  out[3] = 0x00;
  out[4] = len & 0xff;
  out[5] = (len >> 8) & 0xff;
  for (let i = 0; i < len; i++) out[6 + i] = payload[i] & 0xff;
  out[6 + len] = crc8Dallas(payload);
  out[7 + len] = 0xff;
  return out;
}

export const catPacket = (command: number, payload: ArrayLike<number>): Uint8Array =>
  funPrintPacket([0x51, 0x78], command, payload);

export const mxw01Packet = (command: number, payload: ArrayLike<number>): Uint8Array =>
  funPrintPacket([0x22, 0x21], command, payload);

export interface FunPrintGattChars {
  serviceUuid: string;
  controlCharUuid: string;
  dataCharUuid?: string;
  notifyCharUuid?: string;
  dialect: BlePrintDialect;
}

export function detectFunPrintFromUuids(
  serviceUuid: string,
  characteristicUuids: string[]
): FunPrintGattChars | null {
  if (!isFunPrintServiceUuid(serviceUuid)) return null;

  const control = FUN_PRINT_CONTROL_CHAR_UUIDS.find((known) =>
    characteristicUuids.some((u) => uuidEquals(u, known))
  );
  if (!control) return null;

  const hasData = characteristicUuids.some((u) => uuidEquals(u, FUN_PRINT_DATA_CHAR_UUID));
  const hasNotify = characteristicUuids.some((u) => uuidEquals(u, FUN_PRINT_NOTIFY_CHAR_UUID));

  // AE03 = MXW01 bulk data path. AE01+AE02 without AE03 = classic cat.
  // AE01 alone is often an ESC/POS serial pipe on the same service — leave those on ESC/POS.
  let dialect: BlePrintDialect = 'escpos';
  if (hasData) dialect = 'funprint_mxw01';
  else if (hasNotify) dialect = 'funprint_cat';

  return {
    serviceUuid,
    controlCharUuid: characteristicUuids.find((u) => uuidEquals(u, control)) ?? control,
    dataCharUuid: hasData
      ? characteristicUuids.find((u) => uuidEquals(u, FUN_PRINT_DATA_CHAR_UUID))
      : undefined,
    notifyCharUuid: hasNotify
      ? characteristicUuids.find((u) => uuidEquals(u, FUN_PRINT_NOTIFY_CHAR_UUID))
      : undefined,
    dialect,
  };
}

export function detectFunPrintFromServices(
  services: { uuid: string; characteristics: { uuid: string }[] }[]
): FunPrintGattChars | null {
  for (const service of services) {
    const found = detectFunPrintFromUuids(
      service.uuid,
      service.characteristics.map((c) => c.uuid)
    );
    if (found && found.dialect !== 'escpos') return found;
  }
  // AE30 present but AE01-only: caller should treat as ESC/POS over that write char.
  for (const service of services) {
    const found = detectFunPrintFromUuids(
      service.uuid,
      service.characteristics.map((c) => c.uuid)
    );
    if (found) return found;
  }
  return null;
}

export const isFunPrintDialect = (d: BlePrintDialect): boolean =>
  d === 'funprint_cat' || d === 'funprint_mxw01';

export type FunPrintDither = 'threshold' | 'floyd-steinberg';

/** LSB-first: leftmost pixel is bit 0. Black = 1. */
export function packRowLsbFirst(row: ArrayLike<number>): Uint8Array {
  const bytes = Math.ceil(row.length / 8);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < row.length; i++) {
    if (row[i]) out[i >> 3] |= 1 << (i & 7);
  }
  return out;
}

export function padMxw01Image(image: Uint8Array): Uint8Array {
  if (image.length >= MXW01_MIN_IMAGE_BYTES) return image;
  const out = new Uint8Array(MXW01_MIN_IMAGE_BYTES);
  out.set(image);
  return out;
}

function grayscaleAt(data: Uint8ClampedArray, idx: number): number {
  const a = data[idx + 3];
  if (a < 8) return 255;
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

function floydSteinbergMono(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cutoff: number
): Uint8Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = grayscaleAt(data, i * 4);
  }
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const next = old < cutoff ? 0 : 255;
      bits[i] = next === 0 ? 1 : 0;
      const err = old - next;
      if (x + 1 < width) gray[i + 1] += err * (7 / 16);
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += err * (3 / 16);
        gray[i + width] += err * (5 / 16);
        if (x + 1 < width) gray[i + width + 1] += err * (1 / 16);
      }
    }
  }
  return bits;
}

export function rasterCanvasToRows(
  canvas: HTMLCanvasElement,
  options?: { dither?: FunPrintDither; threshold?: number; widthDots?: number }
): Uint8Array[] {
  const widthDots = options?.widthDots ?? FUN_PRINT_WIDTH_DOTS;
  const threshold = options?.threshold ?? 128;
  const dither = options?.dither ?? 'threshold';

  const srcW = Math.max(1, canvas.width);
  const srcH = Math.max(1, canvas.height);
  const height = Math.max(8, Math.round((srcH * widthDots) / srcW));

  const scaled = document.createElement('canvas');
  scaled.width = widthDots;
  scaled.height = height;
  const ctx = scaled.getContext('2d');
  if (!ctx) throw new Error('Could not create Fun Print canvas context');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthDots, height);
  ctx.imageSmoothingEnabled = dither === 'floyd-steinberg';
  ctx.drawImage(canvas, 0, 0, widthDots, height);

  const img = ctx.getImageData(0, 0, widthDots, height);
  const bits =
    dither === 'floyd-steinberg'
      ? floydSteinbergMono(img.data, widthDots, height, threshold)
      : (() => {
          const out = new Uint8Array(widthDots * height);
          for (let i = 0; i < widthDots * height; i++) {
            const g = grayscaleAt(img.data, i * 4);
            out[i] = g < threshold && img.data[i * 4 + 3] > 50 ? 1 : 0;
          }
          return out;
        })();

  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = bits.subarray(y * widthDots, (y + 1) * widthDots);
    rows.push(packRowLsbFirst(row));
  }
  return rows;
}

const CAT_LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const CAT_LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];

export function buildCatKeepAlive(): Uint8Array {
  return catPacket(0xa3, [0x00]);
}

export function buildMxw01KeepAlive(): Uint8Array {
  return mxw01Packet(0xa1, [0x00]);
}

export function buildCatPrintPackets(rows: Uint8Array[], energy = 0xffff): Uint8Array[] {
  const packets: Uint8Array[] = [
    catPacket(0xa3, [0x00]),
    catPacket(0xa4, [0x32]),
    catPacket(0xaf, [(energy >> 8) & 0xff, energy & 0xff]),
    catPacket(0xbe, [0x01]),
    catPacket(0xa6, CAT_LATTICE_START),
  ];
  for (const row of rows) {
    packets.push(catPacket(0xa2, row));
  }
  packets.push(catPacket(0xbd, [0x28]));
  packets.push(catPacket(0xa1, [0x30, 0x00]));
  packets.push(catPacket(0xa1, [0x30, 0x00]));
  packets.push(catPacket(0xa6, CAT_LATTICE_END));
  packets.push(catPacket(0xa3, [0x00]));
  return packets;
}

export interface Mxw01PrintJob {
  intensity: Uint8Array;
  status: Uint8Array;
  printRequest: Uint8Array;
  image: Uint8Array;
  flush: Uint8Array;
  lineCount: number;
}

export function buildMxw01PrintJob(rows: Uint8Array[], intensity = 0x5d): Mxw01PrintJob {
  const lineCount = Math.max(rows.length, Math.ceil(MXW01_MIN_IMAGE_BYTES / FUN_PRINT_BYTES_PER_ROW));
  const raw = new Uint8Array(rows.length * FUN_PRINT_BYTES_PER_ROW);
  for (let i = 0; i < rows.length; i++) {
    raw.set(rows[i].length >= FUN_PRINT_BYTES_PER_ROW ? rows[i].subarray(0, FUN_PRINT_BYTES_PER_ROW) : rows[i], i * FUN_PRINT_BYTES_PER_ROW);
  }
  const image = padMxw01Image(raw);
  return {
    intensity: mxw01Packet(0xa2, [intensity & 0xff]),
    status: mxw01Packet(0xa1, [0x00]),
    printRequest: mxw01Packet(0xa9, [lineCount & 0xff, (lineCount >> 8) & 0xff, 0x30, 0x00]),
    image,
    flush: mxw01Packet(0xad, [0x00]),
    lineCount,
  };
}

export function parseFunPrintNotifyCommand(bytes: ArrayLike<number>): number | null {
  if (bytes.length < 3) return null;
  const b0 = bytes[0] & 0xff;
  const b1 = bytes[1] & 0xff;
  if ((b0 === 0x51 && b1 === 0x78) || (b0 === 0x22 && b1 === 0x21)) {
    return bytes[2] & 0xff;
  }
  return null;
}

export function dialectSummary(dialect: BlePrintDialect): string {
  switch (dialect) {
    case 'funprint_mxw01':
      return 'Fun Print (MXW01) · photos, stickers, notes, receipts';
    case 'funprint_cat':
      return 'Fun Print (pocket) · photos, stickers, notes, receipts';
    default:
      return 'ESC/POS · text + raster bitmap';
  }
}
