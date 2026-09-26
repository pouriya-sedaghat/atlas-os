import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateSnapshotTree } from '../../packages/atlas-os/src/internal/snapshot/validate.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';
import { addSearchComponent, remark, type ManifestRecord } from '../helpers/search-snapshot.js';

const contexts: TestPlatform[] = [];
const posix = process.platform !== 'win32';

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

async function preparedSlot(): Promise<string> {
  const context = await createTestPlatform();
  contexts.push(context);
  await context.platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
  return join(context.dataRoot, 'slots', 'blue');
}

async function failedChecks(slotRoot: string): Promise<string[]> {
  const report = await validateSnapshotTree({ expectedRegion: 'iran', snapshotRoot: slotRoot });
  return report.checks.filter((check) => check.status === 'failed').map((check) => check.name);
}

function node(slotRoot: string, ...segments: string[]): string {
  return join(slotRoot, 'search', 'engine', 'photon_data', 'node_1', ...segments);
}

const REGION_EXTRACT = {
  bytes: 2319,
  checksum: `sha256:${'7'.repeat(64)}`,
  filename: 'region.osm.pbf',
  kind: 'region_extract',
  name: 'region.osm.pbf',
  timestamp: '2026-09-01T00:00:00.000Z',
} as const;

const OSM_ATTRIBUTION = {
  licence: 'ODbL-1.0',
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
} as const;

describe('schema-2 search validation', () => {
  it('accepts a sealed search component bound to its snapshot', async () => {
    const slot = await preparedSlot();
    await addSearchComponent(slot);
    const report = await validateSnapshotTree({ expectedRegion: 'iran', snapshotRoot: slot });
    expect(report.checks.filter((check) => check.status === 'failed')).toEqual([]);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'search_component',
        'search_provenance',
        'search_generation',
        'search_engine_tree',
      ]),
    );
    expect(report.valid).toBe(true);
  });

  it('adds no search checks to a schema-1 snapshot', async () => {
    const slot = await preparedSlot();
    const report = await validateSnapshotTree({ expectedRegion: 'iran', snapshotRoot: slot });
    expect(report.valid).toBe(true);
    expect(report.checks.some((check) => check.name.startsWith('search_'))).toBe(false);
  });

  it('accepts search built from the same regional extract as the basemap', async () => {
    const slot = await preparedSlot();
    await addSearchComponent(slot, (manifest) => {
      manifest['inputs'] = [REGION_EXTRACT];
      manifest.search['attribution'] = OSM_ATTRIBUTION;
      manifest.search.source = {
        bytes: REGION_EXTRACT.bytes,
        checksum: REGION_EXTRACT.checksum,
        kind: 'region_extract',
      };
      remark(manifest);
    });
    expect(await failedChecks(slot)).toEqual([]);
  });

  const manifestCases: readonly (readonly [string, string, (manifest: ManifestRecord) => void])[] =
    [
      [
        'a search component not marked ready',
        'search_component',
        (manifest) => {
          manifest['components'] = { basemap: 'ready', search: 'failed' };
        },
      ],
      [
        'a canary inside the public region',
        'search_component',
        (manifest) => {
          (manifest.search['canary'] as Record<string, unknown>)['coordinate'] = {
            latitude: 35.7,
            longitude: 51.4,
          };
        },
      ],
      [
        'a reverse probe outside the bounds',
        'search_component',
        (manifest) => {
          (manifest.search['probes'] as Record<string, unknown>[])[1]!['coordinate'] = {
            latitude: 10,
            longitude: 10,
          };
        },
      ],
      [
        'a search probe that is not canonical',
        'search_component',
        (manifest) => {
          (manifest.search['probes'] as Record<string, unknown>[])[0]!['query'] =
            `${String.fromCodePoint(0x0643)}رج`;
        },
      ],
      [
        'a regional extract other than the basemap input',
        'search_provenance',
        (manifest) => {
          manifest['inputs'] = [REGION_EXTRACT];
          manifest.search['attribution'] = OSM_ATTRIBUTION;
          manifest.search.source = {
            bytes: REGION_EXTRACT.bytes,
            checksum: `sha256:${'8'.repeat(64)}`,
            kind: 'region_extract',
          };
          remark(manifest);
        },
      ],
      [
        'synthetic search in a snapshot built from a regional extract',
        'search_provenance',
        (manifest) => {
          manifest['inputs'] = [REGION_EXTRACT];
        },
      ],
      [
        'regional search without map data attribution',
        'search_provenance',
        (manifest) => {
          manifest['inputs'] = [REGION_EXTRACT];
          manifest.search.source = {
            bytes: REGION_EXTRACT.bytes,
            checksum: REGION_EXTRACT.checksum,
            kind: 'region_extract',
          };
          remark(manifest);
        },
      ],
      [
        'synthetic search claiming map data attribution',
        'search_provenance',
        (manifest) => {
          manifest.search['attribution'] = OSM_ATTRIBUTION;
        },
      ],
      [
        'a marker that does not match its inputs',
        'search_generation',
        (manifest) => {
          manifest.search.dump['sha256'] = `sha256:${'9'.repeat(64)}`;
        },
      ],
      [
        'an import date later than the snapshot',
        'search_generation',
        (manifest) => {
          manifest.search.engine['importDate'] = '2099-01-01T00:00:00.000Z';
          remark(manifest);
        },
      ],
      [
        'a tree digest that disagrees with the tree',
        'search_engine_tree',
        (manifest) => {
          manifest.search.engine['treeDigest'] = `sha256:${'a'.repeat(64)}`;
        },
      ],
      [
        'a recorded size that disagrees with the tree',
        'search_engine_tree',
        (manifest) => {
          manifest.search.engine['bytes'] = 1;
        },
      ],
      [
        'a recorded engine file that is not in the tree',
        'search_engine_tree',
        (manifest) => {
          manifest.checksums['search/engine/photon_data/node_1/missing'] =
            `sha256:${'b'.repeat(64)}`;
        },
      ],
    ];

  it.each(manifestCases)('rejects %s', async (_label, check, mutate) => {
    const slot = await preparedSlot();
    await addSearchComponent(slot, mutate);
    expect(await failedChecks(slot)).toEqual([check]);
  });

  const treeCases: readonly (readonly [string, (slot: string) => Promise<void>])[] = [
    [
      'a modified engine file',
      (slot) =>
        writeFile(node(slot, 'data', 'nodes', '0', 'segments_1'), Buffer.from([9, 9, 9, 9])),
    ],
    ['an unrecorded engine file', (slot) => writeFile(node(slot, 'data', 'extra'), 'x')],
    ['a removed engine file', (slot) => rm(node(slot, 'data', 'nodes', '0', 'segments_1'))],
    [
      'run-time output left in the tree',
      async (slot) => {
        await mkdir(node(slot, 'logs'));
      },
    ],
    [
      'a host path in a text file',
      (slot) => writeFile(node(slot, 'config', 'opensearch.yml'), 'path.data: /home/operator/x\n'),
    ],
  ];

  it.each(treeCases)('rejects %s', async (_label, tamper) => {
    const slot = await preparedSlot();
    await addSearchComponent(slot);
    await tamper(slot);
    expect(await failedChecks(slot)).toEqual(['search_engine_tree']);
  });

  it.skipIf(!posix)('rejects a changed mode and a symbolic link', async () => {
    const slot = await preparedSlot();
    await addSearchComponent(slot);
    await chmod(node(slot, 'config', 'opensearch.yml'), 0o666);
    expect(await failedChecks(slot)).toEqual(['search_engine_tree']);

    const other = await preparedSlot();
    await addSearchComponent(other);
    await symlink('/etc/hostname', node(other, 'config', 'link'));
    expect(await failedChecks(other)).toEqual(['search_engine_tree']);
  });
});
