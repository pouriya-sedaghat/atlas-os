import { deflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) body[index] = type.charCodeAt(index);
  body.set(data, 4);

  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body), false);
  return out;
}

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes, four per pixel. */
  readonly data: Uint8Array;
}

/**
 * Encodes an 8-bit RGBA image as a PNG.
 *
 * Every scanline uses filter type 0 (none), which keeps the encoder small and the output
 * byte-for-byte reproducible for a given image — a property the snapshot checksums rely on.
 */
export function encodePng(image: RgbaImage): Uint8Array {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, image.width, false);
  headerView.setUint32(4, image.height, false);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(image.data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }

  const compressed = new Uint8Array(deflateSync(raw, { level: 9 }));
  const chunks = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of chunks) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}
