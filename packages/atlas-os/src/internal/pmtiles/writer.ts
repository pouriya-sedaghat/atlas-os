import { gzipSync } from 'node:zlib';

import { Compression, TileType, zxyToTileId } from 'pmtiles';

import { PlatformError } from '../../errors.js';

const HEADER_BYTES = 127;
const MAGIC = 'PMTiles';
const SPEC_VERSION = 3;
/**
 * A PMTiles root directory must fit in the first 16 KiB so a client can fetch the header and the
 * whole root index in one request. Archives large enough to overflow it need leaf directories,
 * which only the external tile tool produces.
 */
const MAX_ROOT_DIRECTORY_BYTES = 16_384 - HEADER_BYTES;

export interface PmtilesTileInput {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Uncompressed tile payload; the writer applies the archive's tile compression. */
  readonly data: Uint8Array;
}

export interface PmtilesBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface PmtilesArchiveOptions {
  readonly bounds: PmtilesBounds;
  readonly center: { readonly longitude: number; readonly latitude: number; readonly zoom: number };
  readonly maxZoom: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly minZoom: number;
}

interface DirectoryEntry {
  readonly tileId: number;
  readonly offset: number;
  readonly length: number;
  readonly runLength: number;
}

class VarintWriter {
  #bytes: number[] = [];

  writeVarint(value: number): void {
    let remaining = value;
    while (remaining >= 0x80) {
      this.#bytes.push((remaining & 0x7f) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.#bytes.push(remaining);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

/**
 * Serialises entries in the PMTiles v3 directory layout: a count, then four columnar runs of
 * varints (delta-encoded tile IDs, run lengths, lengths, offsets). An offset of `0` means the
 * entry continues directly after its predecessor; any other offset is stored plus one.
 */
export function serializeDirectory(entries: readonly DirectoryEntry[]): Uint8Array {
  const writer = new VarintWriter();
  writer.writeVarint(entries.length);

  let lastId = 0;
  for (const entry of entries) {
    writer.writeVarint(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) writer.writeVarint(entry.runLength);
  for (const entry of entries) writer.writeVarint(entry.length);
  for (const [index, entry] of entries.entries()) {
    const previous = index > 0 ? entries[index - 1] : undefined;
    const isContiguous =
      previous !== undefined && entry.offset === previous.offset + previous.length;
    writer.writeVarint(isContiguous ? 0 : entry.offset + 1);
  }
  return writer.toUint8Array();
}

function writeUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value % 2 ** 32, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

function coordinateE7(value: number): number {
  return Math.round(value * 10_000_000);
}

export function buildHeader(fields: {
  readonly rootDirectoryOffset: number;
  readonly rootDirectoryLength: number;
  readonly jsonMetadataOffset: number;
  readonly jsonMetadataLength: number;
  readonly tileDataOffset: number;
  readonly tileDataLength: number;
  readonly numAddressedTiles: number;
  readonly numTileEntries: number;
  readonly numTileContents: number;
  readonly options: PmtilesArchiveOptions;
}): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[7] = SPEC_VERSION;

  writeUint64(view, 8, fields.rootDirectoryOffset);
  writeUint64(view, 16, fields.rootDirectoryLength);
  writeUint64(view, 24, fields.jsonMetadataOffset);
  writeUint64(view, 32, fields.jsonMetadataLength);
  // Leaf directories are unused: the root directory addresses every tile.
  writeUint64(view, 40, 0);
  writeUint64(view, 48, 0);
  writeUint64(view, 56, fields.tileDataOffset);
  writeUint64(view, 64, fields.tileDataLength);
  writeUint64(view, 72, fields.numAddressedTiles);
  writeUint64(view, 80, fields.numTileEntries);
  writeUint64(view, 88, fields.numTileContents);

  const { options } = fields;
  view.setUint8(96, 1); // clustered: entries are ordered by tile ID
  view.setUint8(97, Compression.Gzip);
  view.setUint8(98, Compression.Gzip);
  view.setUint8(99, TileType.Mvt);
  view.setUint8(100, options.minZoom);
  view.setUint8(101, options.maxZoom);
  view.setInt32(102, coordinateE7(options.bounds.west), true);
  view.setInt32(106, coordinateE7(options.bounds.south), true);
  view.setInt32(110, coordinateE7(options.bounds.east), true);
  view.setInt32(114, coordinateE7(options.bounds.north), true);
  view.setUint8(118, options.center.zoom);
  view.setInt32(119, coordinateE7(options.center.longitude), true);
  view.setInt32(123, coordinateE7(options.center.latitude), true);
  return bytes;
}

/**
 * Builds a complete single-file PMTiles v3 archive whose payload is MVT vector data.
 *
 * Identical tile payloads are stored once and addressed by several directory entries, which is
 * what `numAddressedTiles` and `numTileContents` distinguish.
 */
export function buildPmtilesArchive(
  tiles: readonly PmtilesTileInput[],
  options: PmtilesArchiveOptions,
): Uint8Array {
  if (tiles.length === 0) {
    throw new PlatformError(
      'VALIDATION_FAILED',
      'A basemap archive must contain at least one tile.',
    );
  }

  const compressedByChecksum = new Map<string, { offset: number; length: number }>();
  const body: Uint8Array[] = [];
  const entries: DirectoryEntry[] = [];
  let tileDataLength = 0;

  const ordered = [...tiles].sort(
    (left, right) => zxyToTileId(left.z, left.x, left.y) - zxyToTileId(right.z, right.x, right.y),
  );

  for (const tile of ordered) {
    const compressed = new Uint8Array(gzipSync(tile.data, { level: 9 }));
    const key = Buffer.from(compressed).toString('base64');
    let placement = compressedByChecksum.get(key);
    if (placement === undefined) {
      placement = { length: compressed.length, offset: tileDataLength };
      compressedByChecksum.set(key, placement);
      body.push(compressed);
      tileDataLength += compressed.length;
    }
    entries.push({
      length: placement.length,
      offset: placement.offset,
      runLength: 1,
      tileId: zxyToTileId(tile.z, tile.x, tile.y),
    });
  }

  const directory = new Uint8Array(gzipSync(serializeDirectory(entries), { level: 9 }));
  if (directory.length > MAX_ROOT_DIRECTORY_BYTES) {
    throw new PlatformError(
      'VALIDATION_FAILED',
      'Archive needs leaf directories, which this builder does not emit.',
      { details: { directoryBytes: directory.length, limit: MAX_ROOT_DIRECTORY_BYTES } },
    );
  }

  const metadata = new Uint8Array(
    gzipSync(Buffer.from(JSON.stringify(options.metadata), 'utf8'), { level: 9 }),
  );

  const rootDirectoryOffset = HEADER_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + directory.length;
  const tileDataOffset = jsonMetadataOffset + metadata.length;

  const header = buildHeader({
    jsonMetadataLength: metadata.length,
    jsonMetadataOffset,
    numAddressedTiles: entries.length,
    numTileContents: compressedByChecksum.size,
    numTileEntries: entries.length,
    options,
    rootDirectoryLength: directory.length,
    rootDirectoryOffset,
    tileDataLength,
    tileDataOffset,
  });

  const archive = new Uint8Array(tileDataOffset + tileDataLength);
  archive.set(header, 0);
  archive.set(directory, rootDirectoryOffset);
  archive.set(metadata, jsonMetadataOffset);
  let cursor = tileDataOffset;
  for (const chunk of body) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}
