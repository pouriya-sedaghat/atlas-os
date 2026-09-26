import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { generationMarker } from '../../packages/atlas-os/src/internal/search/marker.js';
import {
  ENGINE_DATA_DIRECTORY,
  sealEngineTree,
} from '../../packages/atlas-os/src/internal/search/seal.js';

export type ManifestRecord = Record<string, unknown> & {
  checksums: Record<string, string>;
  search: Record<string, unknown> & {
    engine: Record<string, unknown>;
    dump: Record<string, unknown>;
    source: Record<string, unknown>;
  };
};

export const SEARCH_IMPORT_DATE = '2026-01-01T00:00:05.123Z';
export const CANARY = { latitude: -89.5, longitude: -179.5 } as const;

/** A place the fake engine serves, in the engine's own response vocabulary. */
export interface FakePlace {
  readonly osm_type: 'N' | 'W' | 'R';
  readonly osm_id: number;
  readonly osm_key: string;
  readonly osm_value: string;
  readonly type: string;
  readonly coordinates: readonly [number, number];
  readonly names?: { readonly fa: string; readonly en: string };
  readonly housenumber?: string;
}

export const DEFAULT_FAKE_PLACES: readonly FakePlace[] = [
  {
    coordinates: [51.389, 35.6892],
    names: { en: 'Tehran', fa: 'تهران' },
    osm_id: 8_000_000_000_000_001,
    osm_key: 'place',
    osm_type: 'N',
    osm_value: 'city',
    type: 'city',
  },
  {
    coordinates: [51.3605, 35.7002],
    housenumber: '12',
    osm_id: 8_000_000_000_000_009,
    osm_key: 'place',
    osm_type: 'N',
    osm_value: 'house',
    type: 'house',
  },
];

export interface SearchComponentOptions {
  readonly places?: readonly FakePlace[];
  readonly importDate?: string;
  /** Delay before the fake engine starts listening. */
  readonly startupMs?: number;
  /** Probes recorded in the manifest; defaults ask for the two default places. */
  readonly probes?: readonly Record<string, unknown>[];
}

/**
 * Turns a prepared basemap-only slot into a schema-2 snapshot with a sealed search tree.
 *
 * The tree is shaped like the engine's output and carries the data the test engine stand-in
 * serves, bound to the snapshot's real generation marker. Validation reads files, digests and
 * provenance, never the engine; the host tests start the stand-in on a working copy of it.
 */
export async function addSearchComponent(
  slotRoot: string,
  mutate: (manifest: ManifestRecord) => void = () => undefined,
  options: SearchComponentOptions = {},
): Promise<ManifestRecord> {
  const manifestPath = join(slotRoot, 'manifest.json');
  const v1 = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown> & {
    checksums: Record<string, string>;
    snapshotId: string;
    source: { timestamp: string };
  };
  const importDate = options.importDate ?? SEARCH_IMPORT_DATE;
  const sourceChecksum = `sha256:${'5'.repeat(64)}`;
  const dumpChecksum = `sha256:${'6'.repeat(64)}`;
  const marker = generationMarker({
    dumpChecksum,
    engineImportDate: importDate,
    snapshotId: v1.snapshotId,
    sourceChecksum,
    sourceTimestamp: v1.source.timestamp,
  });

  const node = join(slotRoot, 'search', 'engine', ENGINE_DATA_DIRECTORY, 'node_1');
  await mkdir(join(node, 'config'), { recursive: true });
  await mkdir(join(node, 'data', 'nodes', '0'), { recursive: true });
  await writeFile(join(node, 'config', 'opensearch.yml'), '#path.data: /path/to/data\n');
  await writeFile(join(node, 'data', 'nodes', '0', 'segments_1'), Buffer.from([1, 2, 3, 4]));
  await writeFile(
    join(node, 'data', 'fake-engine.json'),
    `${JSON.stringify({
      canary: CANARY,
      generation: marker,
      importDate,
      places: options.places ?? DEFAULT_FAKE_PLACES,
      startupMs: options.startupMs ?? 0,
    })}\n`,
  );

  const sealed = await sealEngineTree({
    engineRoot: join(slotRoot, 'search', 'engine'),
    forbiddenPaths: [slotRoot],
  });

  const manifest: ManifestRecord = {
    ...v1,
    checksums: { ...v1.checksums, ...sealed.checksums },
    components: { basemap: 'ready', search: 'ready' },
    inputs: [],
    schemaVersion: 2,
    search: {
      attribution: {
        licence: 'none',
        text: 'Synthetic development fixture — not map data',
        url: null,
      },
      canary: { coordinate: CANARY, objectId: 0, objectType: 'X' },
      dump: {
        bytes: 4096,
        documents: 10,
        places: 10,
        sha256: dumpChecksum,
        variants: { addresses: 0, housenumbers: 1, names: 1, postcodes: 0 },
      },
      engine: {
        bytes: sealed.listing.bytes,
        directories: sealed.listing.directories,
        files: sealed.listing.files,
        importDate,
        root: 'search/engine',
        treeDigest: sealed.listing.digest,
      },
      generationMarker: marker,
      languages: ['fa', 'en'],
      probes: options.probes ?? [
        { expectId: 'osm:node:8000000000000001', language: 'fa', query: 'تهران', type: 'search' },
        {
          coordinate: { latitude: 35.7002, longitude: 51.3605 },
          expectId: 'osm:node:8000000000000009',
          language: 'fa',
          type: 'reverse',
        },
      ],
      source: { checksum: sourceChecksum, kind: 'synthetic' },
      tools: [{ name: 'engine', version: '1.3.0' }],
    },
  };
  mutate(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Recomputes the marker after a test changes one of its inputs on purpose. */
export function remark(manifest: ManifestRecord): void {
  manifest.search['generationMarker'] = generationMarker({
    dumpChecksum: manifest.search.dump['sha256'] as string,
    engineImportDate: manifest.search.engine['importDate'] as string,
    snapshotId: manifest['snapshotId'] as string,
    sourceChecksum: manifest.search.source['checksum'] as string,
    sourceTimestamp: (manifest['source'] as { timestamp: string }).timestamp,
  });
}
