import { readFileSync } from 'node:fs';

import { parseActivePointer, parseSnapshotManifest, PlatformError } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/snapshots/${name}`, import.meta.url), 'utf8'),
  );
}

describe('snapshot manifest validation', () => {
  it('accepts a manifest that carries no component yet', () => {
    expect(parseSnapshotManifest(fixture('valid.json'))).toMatchObject({
      region: 'iran',
      schemaVersion: 1,
      snapshotId: 'm0-fixture',
    });
  });

  it('accepts a manifest describing an installed basemap', () => {
    const manifest = parseSnapshotManifest(fixture('valid-basemap.json'));
    expect(manifest.basemap).toMatchObject({
      labelLanguages: ['fa', 'en'],
      maxZoom: 13,
      mediaType: 'application/vnd.pmtiles',
      minZoom: 0,
      vectorFormat: 'mvt',
    });
    expect(manifest.basemap?.sourceLayers).toContain('place');
  });

  it('rejects invalid timestamps, IDs, schemas, and checksums', () => {
    expect(() => parseSnapshotManifest(fixture('invalid.json'))).toThrow(PlatformError);
  });

  it('rejects unknown fields so a manifest cannot smuggle extra state', () => {
    const manifest = fixture('valid.json') as Record<string, unknown>;
    expect(() => parseSnapshotManifest({ ...manifest, unexpected: true })).toThrow(PlatformError);
  });

  it.each([
    ['a raster media type', { mediaType: 'image/png' }],
    ['a non-vector payload', { vectorFormat: 'raster' }],
    ['an empty source layer list', { sourceLayers: [] }],
    ['no label language', { labelLanguages: [] }],
    ['a zoom outside the tile scheme', { maxZoom: 30 }],
    ['an out-of-range latitude', { bounds: { east: 63, north: 100, south: 24, west: 44 } }],
  ])('rejects a basemap component with %s', (_case, overrides) => {
    const manifest = fixture('valid-basemap.json') as Record<string, unknown>;
    const basemap = { ...(manifest['basemap'] as Record<string, unknown>), ...overrides };
    expect(() => parseSnapshotManifest({ ...manifest, basemap })).toThrow(PlatformError);
  });
});

describe('active pointer validation', () => {
  const pointer = {
    activatedAt: '2026-01-01T00:00:00.000Z',
    previous: null,
    schemaVersion: 1,
    slot: 'blue',
    snapshotId: 'iran-20260101t000000z-abcdef01',
  };

  it('accepts a pointer with and without a rollback target', () => {
    expect(parseActivePointer(pointer)).toMatchObject({ slot: 'blue' });
    expect(
      parseActivePointer({
        ...pointer,
        previous: {
          activatedAt: '2025-12-01T00:00:00.000Z',
          slot: 'green',
          snapshotId: 'iran-20251201t000000z-01234567',
        },
      }).previous,
    ).toMatchObject({ slot: 'green' });
  });

  it.each([
    ['an unknown slot', { slot: 'red' }],
    ['a malformed snapshot identifier', { snapshotId: 'NOT VALID' }],
    ['a malformed timestamp', { activatedAt: 'yesterday' }],
    ['a future schema version', { schemaVersion: 2 }],
    ['an unexpected field', { pinned: true }],
  ])('rejects a pointer with %s', (_case, overrides) => {
    expect(() => parseActivePointer({ ...pointer, ...overrides })).toThrow(PlatformError);
  });

  it('rejects a rollback target that is not a complete reference', () => {
    expect(() => parseActivePointer({ ...pointer, previous: { slot: 'green' } })).toThrow(
      PlatformError,
    );
  });
});
