import { describe, expect, it } from 'vitest';
import {
  buildCatPrintPackets,
  buildMxw01PrintJob,
  catPacket,
  crc8Dallas,
  detectFunPrintFromUuids,
  detectFunPrintFromServices,
  MXW01_MIN_IMAGE_BYTES,
  mxw01Packet,
  packRowLsbFirst,
  padMxw01Image,
  parseFunPrintNotifyCommand,
} from './funPrintProtocol';

describe('Fun Print CRC-8 Dallas/Maxim', () => {
  it('matches the known quality command checksum (payload 0x32 → 0x9E)', () => {
    expect(crc8Dallas([0x32])).toBe(0x9e);
  });

  it('checksums a zero payload as 0', () => {
    expect(crc8Dallas([0x00])).toBe(0x00);
  });
});

describe('Fun Print packet framing', () => {
  it('builds a cat (0x5178) packet with CRC and footer', () => {
    const pkt = catPacket(0xa4, [0x32]);
    expect(Array.from(pkt)).toEqual([0x51, 0x78, 0xa4, 0x00, 0x01, 0x00, 0x32, 0x9e, 0xff]);
  });

  it('builds an MXW01 (0x2221) status packet', () => {
    const pkt = mxw01Packet(0xa1, [0x00]);
    expect(pkt[0]).toBe(0x22);
    expect(pkt[1]).toBe(0x21);
    expect(pkt[2]).toBe(0xa1);
    expect(pkt[pkt.length - 1]).toBe(0xff);
    expect(pkt[pkt.length - 2]).toBe(0x00);
  });
});

describe('Fun Print dialect detection (UUID only, no Bluetooth name)', () => {
  it('detects MXW01 when AE03 data characteristic is present', () => {
    const found = detectFunPrintFromUuids('0000ae30-0000-1000-8000-00805f9b34fb', [
      '0000ae01-0000-1000-8000-00805f9b34fb',
      '0000ae02-0000-1000-8000-00805f9b34fb',
      '0000ae03-0000-1000-8000-00805f9b34fb',
    ]);
    expect(found?.dialect).toBe('funprint_mxw01');
    expect(found?.dataCharUuid).toBeTruthy();
  });

  it('detects classic cat when AE01+AE02 exist without AE03', () => {
    const found = detectFunPrintFromUuids('0000af30-0000-1000-8000-00805f9b34fb', [
      '0000ae01-0000-1000-8000-00805f9b34fb',
      '0000ae02-0000-1000-8000-00805f9b34fb',
    ]);
    expect(found?.dialect).toBe('funprint_cat');
    expect(found?.dataCharUuid).toBeUndefined();
  });

  it('leaves AE01-only modules on ESC/POS (raw pipe, not Fun Print)', () => {
    const found = detectFunPrintFromUuids('0000ae30-0000-1000-8000-00805f9b34fb', [
      '0000ae01-0000-1000-8000-00805f9b34fb',
    ]);
    expect(found?.dialect).toBe('escpos');
  });

  it('ignores non Fun Print services', () => {
    expect(
      detectFunPrintFromUuids('000018f0-0000-1000-8000-00805f9b34fb', [
        '00002af1-0000-1000-8000-00805f9b34fb',
      ])
    ).toBeNull();
  });

  it('prefers MXW01 over cat when both-looking services exist', () => {
    const found = detectFunPrintFromServices([
      {
        uuid: '000018f0-0000-1000-8000-00805f9b34fb',
        characteristics: [{ uuid: '00002af1-0000-1000-8000-00805f9b34fb' }],
      },
      {
        uuid: '0000ae30-0000-1000-8000-00805f9b34fb',
        characteristics: [
          { uuid: '0000ae01-0000-1000-8000-00805f9b34fb' },
          { uuid: '0000ae02-0000-1000-8000-00805f9b34fb' },
          { uuid: '0000ae03-0000-1000-8000-00805f9b34fb' },
        ],
      },
    ]);
    expect(found?.dialect).toBe('funprint_mxw01');
  });
});

describe('Fun Print raster packing', () => {
  it('packs leftmost pixel into bit 0', () => {
    const row = new Uint8Array(8);
    row[0] = 1;
    row[7] = 1;
    expect(Array.from(packRowLsbFirst(row))).toEqual([0b10000001]);
  });

  it('pads MXW01 image data to the 90-line minimum', () => {
    const padded = padMxw01Image(new Uint8Array(48));
    expect(padded.length).toBe(MXW01_MIN_IMAGE_BYTES);
    expect(padded[0]).toBe(0);
  });
});

describe('Fun Print job builders', () => {
  it('emits cat scanline packets (0xA2) for each row', () => {
    const row = packRowLsbFirst(new Uint8Array(384).fill(1));
    const packets = buildCatPrintPackets([row]);
    const scan = packets.filter((p) => p[2] === 0xa2);
    expect(scan).toHaveLength(1);
    expect(scan[0][0]).toBe(0x51);
    expect(scan[0][4]).toBe(48);
  });

  it('builds MXW01 print request with little-endian line count', () => {
    const row = packRowLsbFirst(new Uint8Array(384));
    const job = buildMxw01PrintJob([row, row]);
    expect(job.lineCount).toBeGreaterThanOrEqual(90);
    expect(job.printRequest[2]).toBe(0xa9);
    expect(job.image.length).toBe(MXW01_MIN_IMAGE_BYTES);
    expect(job.flush[2]).toBe(0xad);
  });

  it('parses notify command ids from either preamble', () => {
    expect(parseFunPrintNotifyCommand([0x51, 0x78, 0xa3, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff])).toBe(0xa3);
    expect(parseFunPrintNotifyCommand([0x22, 0x21, 0xa9, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff])).toBe(0xa9);
    expect(parseFunPrintNotifyCommand([0x1b, 0x40])).toBeNull();
  });
});
