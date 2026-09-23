import { open } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import type { RangeResponse, Source } from 'pmtiles';
import { Compression, PMTiles, TileType } from 'pmtiles';

import { PlatformError } from '../../errors.js';
import { tileRange } from '../mvt/encode.js';

/**
 * Reads archive byte ranges from the local filesystem so validation uses the same reader the
 * browser uses, without loading the archive into memory.
 */
class LocalFileSource implements Source {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  getKey(): string {
    return this.#path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const handle = await open(this.#path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) };
    } finally {
      await handle.close();
    }
  }
}

function decompress(data: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None) return Promise.resolve(data);
  if (compression === Compression.Gzip) {
    const inflated = gunzipSync(Buffer.from(data));
    return Promise.resolve(
      inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength),
    );
  }
  throw new PlatformError('VALIDATION_FAILED', 'Unsupported archive compression.', {
    details: { compression },
  });
}

export interface ArchiveSummary {
  /** Attribution the archive itself declares, if any. */
  readonly attribution: string | null;
  readonly bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly maxZoom: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly minZoom: number;
  /** Schema identity the producing profile declared, if any. */
  readonly schemaName: string | null;
  readonly schemaVersion: string | null;
  readonly specVersion: number;
  readonly tileCount: number;
  readonly vectorFormat: 'mvt';
  /** Layer names the archive's own metadata declares. */
  readonly vectorLayers: readonly string[];
}

/**
 * Layer identifiers declared by the archive's `vector_layers` metadata.
 *
 * This is the archive's own statement about what it contains, which is what validation compares
 * the style against — not a declaration copied from whatever built it.
 */
function readVectorLayers(metadata: Readonly<Record<string, unknown>>): readonly string[] {
  const declared = metadata['vector_layers'];
  if (!Array.isArray(declared)) return [];
  const names: string[] = [];
  for (const entry of declared) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.length > 0) names.push(id);
  }
  return [...new Set(names)].sort();
}

function readString(metadata: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parses an archive and proves it carries vector tiles. A PMTiles file can hold raster payloads,
 * so the tile type is checked explicitly rather than assumed from the extension.
 */
export async function inspectArchive(path: string): Promise<ArchiveSummary> {
  const archive = new PMTiles(new LocalFileSource(path), undefined, decompress);
  let header;
  try {
    header = await archive.getHeader();
  } catch (error) {
    throw new PlatformError('VALIDATION_FAILED', 'Basemap archive header could not be read.', {
      cause: error,
      details: { path },
    });
  }

  if (header.tileType !== TileType.Mvt) {
    throw new PlatformError('VALIDATION_FAILED', 'Basemap archive does not contain vector tiles.', {
      details: { expected: 'mvt', tileType: header.tileType },
    });
  }
  if (header.maxZoom < header.minZoom) {
    throw new PlatformError('VALIDATION_FAILED', 'Basemap archive zoom range is inverted.', {
      details: { maxZoom: header.maxZoom, minZoom: header.minZoom },
    });
  }

  const metadata = (await archive.getMetadata()) as Readonly<Record<string, unknown>>;
  return {
    attribution: readString(metadata, 'attribution'),
    bounds: {
      east: header.maxLon,
      north: header.maxLat,
      south: header.minLat,
      west: header.minLon,
    },
    maxZoom: header.maxZoom,
    metadata,
    minZoom: header.minZoom,
    schemaName: readString(metadata, 'name'),
    schemaVersion: readString(metadata, 'version'),
    specVersion: header.specVersion,
    tileCount: header.numAddressedTiles,
    vectorFormat: 'mvt',
    vectorLayers: readVectorLayers(metadata),
  };
}

/**
 * Finds a tile the archive actually holds, starting at its minimum zoom.
 *
 * Used to prove an archive is readable end to end rather than merely well-headed. Candidates are
 * derived from the archive's own bounds, so this works for any coverage.
 */
export async function findRepresentativeTile(
  path: string,
  summary: ArchiveSummary,
): Promise<
  | { readonly z: number; readonly x: number; readonly y: number; readonly data: Uint8Array }
  | undefined
> {
  const archive = new PMTiles(new LocalFileSource(path), undefined, decompress);
  const maxProbeZoom = Math.min(summary.maxZoom, summary.minZoom + 3);

  for (let zoom = summary.minZoom; zoom <= maxProbeZoom; zoom += 1) {
    for (const coordinate of tileRange(zoom, summary.bounds)) {
      const tile = await archive.getZxy(coordinate.z, coordinate.x, coordinate.y);
      if (tile !== undefined && tile.data.byteLength > 0) {
        return { ...coordinate, data: new Uint8Array(tile.data) };
      }
    }
  }
  return undefined;
}

/** Reads one tile payload, used to prove a written archive is readable end to end. */
export async function readArchiveTile(
  path: string,
  z: number,
  x: number,
  y: number,
): Promise<Uint8Array | undefined> {
  const archive = new PMTiles(new LocalFileSource(path), undefined, decompress);
  const tile = await archive.getZxy(z, x, y);
  return tile === undefined ? undefined : new Uint8Array(tile.data);
}
