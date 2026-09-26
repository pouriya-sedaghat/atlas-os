import { readFileSync } from 'node:fs';

import {
  parseActivePointer,
  parseSnapshotManifest,
  PlatformError,
  searchComponentOf,
} from '@atlas-os/platform';
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

describe('schema-2 manifests with a search component', () => {
  function v2(): Record<string, unknown> {
    return fixture('valid-search.json') as Record<string, unknown>;
  }
  function withSearch(overrides: Record<string, unknown>): Record<string, unknown> {
    const manifest = v2();
    return { ...manifest, search: { ...(manifest['search'] as object), ...overrides } };
  }

  it('accepts a basemap plus search manifest and exposes its search component', () => {
    const manifest = parseSnapshotManifest(v2());
    expect(manifest.schemaVersion).toBe(2);
    expect(searchComponentOf(manifest)).toMatchObject({
      engine: { root: 'search/engine' },
      languages: ['fa', 'en'],
      source: { kind: 'region_extract' },
    });
  });

  it('keeps schema-1 manifests exactly as M1 wrote them, with no search component', () => {
    const manifest = parseSnapshotManifest(fixture('valid-basemap.json'));
    expect(manifest.schemaVersion).toBe(1);
    expect(searchComponentOf(manifest)).toBeUndefined();
  });

  it('refuses a schema-1 manifest that smuggles a search component', () => {
    const { search } = v2();
    expect(() =>
      parseSnapshotManifest({ ...(fixture('valid-basemap.json') as object), search }),
    ).toThrow(PlatformError);
  });

  it.each([
    ['no search component', (m: Record<string, unknown>) => ({ ...m, search: undefined })],
    ['no basemap component', (m: Record<string, unknown>) => ({ ...m, basemap: undefined })],
    ['no input provenance', (m: Record<string, unknown>) => ({ ...m, inputs: undefined })],
  ])('refuses a schema-2 manifest with %s', (_case, mutate) => {
    expect(() => parseSnapshotManifest(mutate(v2()))).toThrow(PlatformError);
  });

  it.each([
    ['duplicated languages', { languages: ['fa', 'fa'] }],
    ['a user language outside fa and en', { languages: ['fa', 'de'] }],
    [
      'an import date without millisecond precision',
      {
        engine: {
          ...(fixture('valid-search.json') as { search: { engine: object } }).search.engine,
          importDate: '2026-01-01T00:00:05Z',
        },
      },
    ],
    [
      'a probe expecting an engine-internal identifier',
      {
        probes: [{ expectId: '123456', language: 'fa', query: 'abc', type: 'search' }],
      },
    ],
    [
      'a canary that could collide with an OSM object',
      {
        canary: {
          coordinate: { latitude: -89.5, longitude: -179.5 },
          objectId: 1,
          objectType: 'N',
        },
      },
    ],
    [
      'attribution that is neither the OSM credit nor the synthetic notice',
      {
        attribution: {
          licence: 'ODbL-1.0',
          text: 'OSM',
          url: 'https://www.openstreetmap.org/copyright',
        },
      },
    ],
    ['an unknown field', { extra: true }],
  ])('refuses a search component with %s', (_case, overrides) => {
    expect(() => parseSnapshotManifest(withSearch(overrides))).toThrow(PlatformError);
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
