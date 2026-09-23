import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { TileType, bytesToHeader, zxyToTileId } from 'pmtiles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildPmtilesArchive,
  serializeDirectory,
} from '../../packages/atlas-os/src/internal/pmtiles/writer.js';
import {
  inspectArchive,
  readArchiveTile,
} from '../../packages/atlas-os/src/internal/pmtiles/inspect.js';
import { encodeTilePyramid } from '../../packages/atlas-os/src/internal/mvt/encode.js';

const BOUNDS = { east: 10, north: 10, south: 0, west: 0 } as const;
const CENTER = { latitude: 5, longitude: 5, zoom: 3 } as const;

function tile(z: number, x: number, y: number, body: string) {
  return { data: new TextEncoder().encode(body), x, y, z };
}

describe('archive directory serialisation', () => {
  it('delta-encodes tile identifiers and omits contiguous offsets', () => {
    const bytes = serializeDirectory([
      { length: 10, offset: 0, runLength: 1, tileId: 5 },
      { length: 20, offset: 10, runLength: 1, tileId: 9 },
      { length: 30, offset: 100, runLength: 1, tileId: 10 },
    ]);
    // count, then id deltas, run lengths, lengths, offsets. The second entry starts exactly
    // where the first ends, so its offset is stored as the sentinel 0.
    expect([...bytes]).toEqual([3, 5, 4, 1, 1, 1, 1, 10, 20, 30, 1, 0, 101]);
  });
});

describe('archive writing and reading', () => {
  let directory: string;
  let archivePath: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-archive-'));
    archivePath = join(directory, 'test.pmtiles');
    const archive = buildPmtilesArchive(
      [tile(0, 0, 0, 'zero'), tile(1, 0, 0, 'one'), tile(1, 1, 1, 'two'), tile(1, 1, 0, 'one')],
      {
        bounds: BOUNDS,
        center: CENTER,
        maxZoom: 1,
        metadata: { name: 'fixture' },
        minZoom: 0,
      },
    );
    await writeFile(archivePath, archive);
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('writes a header the reference reader accepts', async () => {
    const summary = await inspectArchive(archivePath);
    expect(summary).toMatchObject({
      maxZoom: 1,
      minZoom: 0,
      specVersion: 3,
      tileCount: 4,
      vectorFormat: 'mvt',
    });
    expect(summary.bounds).toEqual({ east: 10, north: 10, south: 0, west: 0 });
    expect(summary.metadata).toMatchObject({ name: 'fixture' });
  });

  it('declares the vector tile type', () => {
    const archive = buildPmtilesArchive([tile(0, 0, 0, 'x')], {
      bounds: BOUNDS,
      center: CENTER,
      maxZoom: 0,
      metadata: {},
      minZoom: 0,
    });
    const header = bytesToHeader(
      archive.buffer.slice(archive.byteOffset, archive.byteOffset + 127) as ArrayBuffer,
    );
    expect(header.tileType).toBe(TileType.Mvt);
    expect(header.clustered).toBe(true);
  });

  it('round-trips every tile through the reference reader', async () => {
    await expect(readArchiveTile(archivePath, 0, 0, 0)).resolves.toEqual(
      new TextEncoder().encode('zero'),
    );
    await expect(readArchiveTile(archivePath, 1, 1, 1)).resolves.toEqual(
      new TextEncoder().encode('two'),
    );
    await expect(readArchiveTile(archivePath, 5, 1, 1)).resolves.toBeUndefined();
  });

  it('stores identical payloads once while addressing them separately', async () => {
    // Tiles 1/0/0 and 1/1/0 carry the same bytes, so the archive holds three distinct payloads
    // for four addressed tiles.
    const summary = await inspectArchive(archivePath);
    expect(summary.tileCount).toBe(4);
    expect(zxyToTileId(1, 0, 0)).not.toBe(zxyToTileId(1, 1, 0));
  });

  it('refuses to write an archive with no tiles', () => {
    expect(() =>
      buildPmtilesArchive([], {
        bounds: BOUNDS,
        center: CENTER,
        maxZoom: 0,
        metadata: {},
        minZoom: 0,
      }),
    ).toThrow(/at least one tile/i);
  });
});

describe('vector tile encoding', () => {
  it('produces decodable vector tiles carrying the source layer and its attributes', () => {
    const tiles = encodeTilePyramid(
      [
        {
          features: {
            features: [
              {
                geometry: { coordinates: [5, 5], type: 'Point' },
                properties: { name: 'Sample', 'name:fa': 'نمونه' },
                type: 'Feature',
              },
            ],
            type: 'FeatureCollection',
          },
          maxZoom: 2,
          minZoom: 0,
          name: 'place',
        },
      ],
      { maxZoom: 2, windows: [{ bounds: BOUNDS, maxZoom: 2, minZoom: 0 }] },
    );

    expect(tiles.length).toBeGreaterThan(0);
    const first = tiles[0]!;
    const decoded = new VectorTile(new PbfReader(first.data));
    expect(Object.keys(decoded.layers)).toContain('place');
    const layer = decoded.layers['place']!;
    expect(layer.length).toBeGreaterThan(0);
    expect(layer.feature(0).properties).toMatchObject({ 'name:fa': 'نمونه', name: 'Sample' });
  });
});
