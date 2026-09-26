import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PlaceResult } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { deduplicatePlaces } from '../../packages/atlas-os/src/internal/search/dedupe.js';
import {
  engineCollectionSchema,
  mapEngineCollection,
  placeId,
} from '../../packages/atlas-os/src/internal/search/mapping.js';
import { generationMarker } from '../../packages/atlas-os/src/internal/search/marker.js';
import { listTree, treeDigest } from '../../packages/atlas-os/src/internal/search/tree.js';

const IRAN = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 };

function feature(properties: Record<string, unknown>, coordinates: [number, number]) {
  return { geometry: { coordinates, type: 'Point' }, properties, type: 'Feature' };
}

describe('generation marker', () => {
  const inputs = {
    dumpChecksum: `sha256:${'b'.repeat(64)}`,
    engineImportDate: '2026-09-01T00:00:00.101Z',
    snapshotId: 'iran-20260901t000000101z-abcdef01',
    sourceChecksum: `sha256:${'a'.repeat(64)}`,
    sourceTimestamp: '2026-09-01T00:00:00.000Z',
  };

  it('matches an independently computed vector', () => {
    // SHA-256 over the newline-joined domain tag and inputs, computed outside this codebase.
    expect(generationMarker(inputs)).toBe(
      'sha256:372ce28fad3d9ce5f4a14134f2c016d8ff3cfa136ac2138d85d6d7c5a745edc3',
    );
  });

  it.each(Object.keys(inputs))('changes when %s changes', (key) => {
    const changed = { ...inputs, [key]: `${inputs[key as keyof typeof inputs]}x` };
    expect(generationMarker(changed)).not.toBe(generationMarker(inputs));
  });

  it('refuses inputs that could forge field boundaries', () => {
    expect(() => generationMarker({ ...inputs, snapshotId: 'a\nb' })).toThrow();
  });
});

describe('engine response mapping', () => {
  const collection = (features: unknown[]) =>
    engineCollectionSchema.parse({ features, type: 'FeatureCollection' });

  it('maps a place to a stable OSM identifier and localised address', () => {
    const [result] = mapEngineCollection(
      collection([
        feature(
          {
            city: 'تهران',
            countrycode: 'IR',
            extent: [51.09, 35.83, 51.61, 35.55],
            name: 'برج میلاد',
            osm_id: 9000001003,
            osm_key: 'man_made',
            osm_type: 'W',
            osm_value: 'tower',
            state: 'استان تهران',
            type: 'other',
          },
          [51.3753, 35.7448],
        ),
      ]),
      { bounds: IRAN },
    );
    expect(result).toEqual({
      address: { city: 'تهران', countryCode: 'ir', state: 'استان تهران' },
      bounds: { east: 51.61, north: 35.83, south: 35.55, west: 51.09 },
      category: 'man_made:tower',
      coordinate: { latitude: 35.7448, longitude: 51.3753 },
      id: 'osm:way:9000001003',
      kind: 'other',
      name: 'برج میلاد',
    } satisfies PlaceResult);
  });

  it('shows original Persian house numbers and postcodes while searching canonical ones', () => {
    const [result] = mapEngineCollection(
      collection([
        feature(
          {
            extra: { atlas_housenumber: '۲۳', atlas_postcode: '۱۴۵۸۸' },
            housenumber: '23',
            osm_id: 9000002004,
            osm_key: 'building',
            osm_type: 'N',
            osm_value: 'house',
            postcode: '14588',
            street: 'خیابان آزادی',
            type: 'house',
          },
          [51.43, 35.73],
        ),
      ]),
      { bounds: IRAN },
    );
    expect(result).toMatchObject({
      address: { housenumber: '۲۳', postcode: '۱۴۵۸۸', street: 'خیابان آزادی' },
      name: 'خیابان آزادی ۲۳',
    });
  });

  it('drops the generation canary by its exact identity even inside the bounds', () => {
    const canary = feature(
      {
        extra: { atlas_generation: 'sha256:x' },
        name: 'atlas',
        osm_id: 0,
        osm_key: 'atlas',
        osm_type: 'X',
        osm_value: 'generation',
      },
      [51.4, 35.7],
    );
    expect(mapEngineCollection(collection([canary]), { bounds: IRAN })).toEqual([]);
  });

  it('drops results outside the snapshot bounds and non-OSM objects', () => {
    const outside = feature(
      {
        name: 'Baghdad street',
        osm_id: 1,
        osm_key: 'highway',
        osm_type: 'W',
        osm_value: 'primary',
      },
      [44.0, 33.3],
    );
    const foreign = feature(
      { name: 'x', osm_id: 5, osm_key: 'place', osm_type: 'P', osm_value: 'city' },
      [51.4, 35.7],
    );
    expect(mapEngineCollection(collection([outside, foreign]), { bounds: IRAN })).toEqual([]);
  });

  it('refuses a response carrying an unexpected field instead of passing it through', () => {
    expect(() => collection([feature({ name: 'x', raw_data: {} }, [51.4, 35.7])])).toThrow();
    expect(() =>
      engineCollectionSchema.parse({
        features: [],
        properties: { debug: 1 },
        type: 'FeatureCollection',
      }),
    ).toThrow();
  });

  it.each([
    ['N', 5, 'osm:node:5'],
    ['W', 6, 'osm:way:6'],
    ['R', 7, 'osm:relation:7'],
    ['X', 0, undefined],
    ['N', 0, undefined],
    ['N', -3, undefined],
    [undefined, 3, undefined],
  ])('derives %s%s to %s', (type, id, expected) => {
    expect(placeId(type, id)).toBe(expected);
  });
});

describe('Atlas de-duplication', () => {
  function street(id: string, city: string, district?: string): PlaceResult {
    return {
      address: { city, ...(district === undefined ? {} : { district }) },
      category: 'highway:primary',
      coordinate: { latitude: 35.7, longitude: 51.37 },
      id,
      kind: 'street',
      name: 'خیابان آزادی',
    };
  }

  it('keeps same-named streets in different cities', () => {
    const results = deduplicatePlaces([street('osm:way:1', 'تهران'), street('osm:way:2', 'شیراز')]);
    expect(results.map((result) => result.id)).toEqual(['osm:way:1', 'osm:way:2']);
  });

  it('collapses split segments of one street in one district, keeping the first', () => {
    const results = deduplicatePlaces([
      street('osm:way:1', 'تهران', 'منطقه ۲'),
      street('osm:way:2', 'تهران', 'منطقه ۲'),
    ]);
    expect(results.map((result) => result.id)).toEqual(['osm:way:1']);
  });

  it('keeps same-named streets in different districts of one city', () => {
    const results = deduplicatePlaces([
      street('osm:way:1', 'تهران', 'منطقه ۲'),
      street('osm:way:2', 'تهران', 'منطقه ۵'),
    ]);
    expect(results).toHaveLength(2);
  });

  it('treats Arabic and Persian spellings of the same name as one identity', () => {
    const arabic = { ...street('osm:way:2', 'تهران'), name: 'خيابان آزادي' };
    expect(deduplicatePlaces([street('osm:way:1', 'تهران'), arabic])).toHaveLength(1);
  });

  it('keys house results by their full address', () => {
    const house = (id: string, number: string): PlaceResult => ({
      address: { city: 'تهران', housenumber: number, street: 'خیابان آزادی' },
      category: 'building:house',
      coordinate: { latitude: 35.7, longitude: 51.36 },
      id,
      kind: 'house',
      name: `خیابان آزادی ${number}`,
    });
    expect(deduplicatePlaces([house('osm:node:1', '12'), house('osm:node:2', '14')])).toHaveLength(
      2,
    );
    expect(deduplicatePlaces([house('osm:node:1', '12'), house('osm:node:2', '۱۲')])).toHaveLength(
      1,
    );
  });
});

describe('sealed tree digest', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function tree(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'atlas-os-tree-'));
    roots.push(root);
    await mkdir(join(root, 'a/b'), { recursive: true });
    await writeFile(join(root, 'a/b/one'), 'one');
    await writeFile(join(root, 'a/two'), 'two');
    await chmod(join(root, 'a'), 0o755);
    await chmod(join(root, 'a/b'), 0o755);
    await chmod(join(root, 'a/b/one'), 0o644);
    await chmod(join(root, 'a/two'), 0o644);
    return root;
  }

  it('is deterministic and independent of listing order', async () => {
    const listing = await listTree(await tree());
    expect(listing).toMatchObject({ bytes: 6, directories: 2, files: 2 });
    expect(treeDigest([...listing.entries].reverse())).toBe(listing.digest);
    expect((await listTree(await tree())).digest).toBe(listing.digest);
  });

  it('changes when content or a path changes, but not with permission bits', async () => {
    const baseline = (await listTree(await tree())).digest;

    const content = await tree();
    await writeFile(join(content, 'a/two'), 'TWO');
    expect((await listTree(content)).digest).not.toBe(baseline);

    // Modes are enforced by the artifact policy, not the digest, so a tree sealed on Linux
    // digests identically on a host that cannot represent them.
    if (process.platform !== 'win32') {
      const mode = await tree();
      await chmod(join(mode, 'a/two'), 0o600);
      const listing = await listTree(mode);
      expect(listing.digest).toBe(baseline);
      expect(listing.entries.find((entry) => entry.path === 'a/two')?.mode).toBe(0o600);
    }

    const renamed = await tree();
    await rename(join(renamed, 'a/two'), join(renamed, 'a/TWO'));
    expect((await listTree(renamed)).digest).not.toBe(baseline);

    const extra = await tree();
    await writeFile(join(extra, 'a/three'), '');
    expect((await listTree(extra)).digest).not.toBe(baseline);
  });

  it.skipIf(process.platform === 'win32')('refuses symbolic links', async () => {
    const root = await tree();
    await symlink('/etc/hostname', join(root, 'a/link'));
    await expect(listTree(root)).rejects.toThrow();
  });
});
