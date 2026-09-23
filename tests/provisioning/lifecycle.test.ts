import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { parseActivePointer, parseSnapshotManifest } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectArchive,
  readArchiveTile,
} from '../../packages/atlas-os/src/internal/pmtiles/inspect.js';
import { sha256File } from '../../packages/atlas-os/src/internal/fs/checksum.js';
import {
  PUBLISHED_SLOT_MODE,
  SnapshotStore,
} from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];

async function platformContext(options?: { readonly region?: string }): Promise<TestPlatform> {
  const context = await createTestPlatform(options);
  contexts.push(context);
  return context;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

async function readPointer(dataRoot: string) {
  return parseActivePointer(JSON.parse(await readFile(join(dataRoot, 'active.json'), 'utf8')));
}

async function readManifest(dataRoot: string, slot: string) {
  return parseSnapshotManifest(
    JSON.parse(await readFile(join(dataRoot, 'slots', slot, 'manifest.json'), 'utf8')),
  );
}

describe('snapshot preparation', () => {
  it('prepares into the inactive slot and leaves the active slot untouched', async () => {
    const { dataRoot, platform } = await platformContext();

    const first = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    expect(await readManifest(dataRoot, 'blue')).toMatchObject({ snapshotId: first });
    await platform.datasets.activateSnapshot(first);
    expect(await readPointer(dataRoot)).toMatchObject({ slot: 'blue', snapshotId: first });

    const activeArchive = join(dataRoot, 'slots', 'blue', 'basemap', 'basemap.pmtiles');
    const activeDigest = await sha256File(activeArchive);
    const activeMtime = (await stat(activeArchive)).mtimeMs;

    const second = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'second' });
    expect(second).not.toBe(first);
    // The new snapshot went to the other slot.
    expect(await readManifest(dataRoot, 'green')).toMatchObject({ snapshotId: second });
    // And the serving slot was not written to at all.
    expect(await readManifest(dataRoot, 'blue')).toMatchObject({ snapshotId: first });
    expect(await sha256File(activeArchive)).toBe(activeDigest);
    expect((await stat(activeArchive)).mtimeMs).toBe(activeMtime);
    expect(await readPointer(dataRoot)).toMatchObject({ slot: 'blue', snapshotId: first });
  });

  it('produces an archive of vector tiles carrying the declared source layers', async () => {
    const { dataRoot, platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
    const manifest = await readManifest(dataRoot, 'blue');
    const archive = join(dataRoot, 'slots', 'blue', 'basemap', 'basemap.pmtiles');

    const summary = await inspectArchive(archive);
    expect(summary.vectorFormat).toBe('mvt');
    expect(summary.specVersion).toBe(3);
    expect(summary.tileCount).toBe(manifest.basemap?.tileCount);
    expect(summary.minZoom).toBe(manifest.basemap?.minZoom);
    expect(summary.maxZoom).toBe(manifest.basemap?.maxZoom);
    expect(manifest.snapshotId).toBe(id);

    // Decode a real tile and confirm it is vector data with the expected layers and labels.
    const tile = await readArchiveTile(archive, 5, 20, 12);
    expect(tile).toBeDefined();
    const decoded = new VectorTile(new PbfReader(tile!));
    const layers = Object.keys(decoded.layers);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(manifest.basemap?.sourceLayers).toContain(layer);
    }
    const places = decoded.layers['place'];
    expect(places).toBeDefined();
    expect(places!.feature(0).properties).toHaveProperty('name:fa');
    expect(places!.feature(0).properties).toHaveProperty('name:en');
  });

  it('refuses a production preparation that omits a required ancillary input', async () => {
    const { dataRoot } = await platformContext();
    const external = await createTestPlatform({ builder: 'external', dataRoot });
    contexts.push(external);

    const extract = join(dataRoot, 'region.osm.pbf');
    await writeFile(extract, 'non-empty');

    // Only the regional extract is supplied. The selected layers also need reference geometry
    // and coastline polygons, so the preparation must refuse rather than build a basemap that is
    // quietly missing those layers' data.
    await expect(
      external.platform.datasets.prepareUpdate({
        inputs: [{ kind: 'region_extract', name: 'extract', path: extract }],
        sourceName: 'incomplete',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      details: { requiredInput: 'reference_features' },
    });

    await expect(readdir(join(dataRoot, 'tmp'))).resolves.toEqual([]);
    await expect(stat(join(dataRoot, 'slots', 'green'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records source provenance, tool versions and a checksum for every artifact', async () => {
    const { dataRoot, platform } = await platformContext();
    await platform.datasets.prepareUpdate({
      sourceName: 'operator-supplied-extract',
      sourceTimestamp: '2026-01-02T03:04:05.000Z',
    });
    const manifest = await readManifest(dataRoot, 'blue');

    expect(manifest.source).toEqual({
      name: 'operator-supplied-extract',
      timestamp: '2026-01-02T03:04:05.000Z',
    });
    expect(manifest.region).toBe('iran');
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(manifest.artifactVersions)).toContain('schema');
    expect(manifest.components).toMatchObject({ basemap: 'ready' });

    const recorded = Object.entries(manifest.checksums);
    expect(recorded.length).toBeGreaterThan(5);
    for (const [relative, digest] of recorded) {
      expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(sha256File(join(dataRoot, 'slots', 'blue', relative))).resolves.toBe(digest);
    }
    // Archive, style, both sprite pairs and at least one glyph range are all recorded.
    const names = recorded.map(([name]) => name);
    expect(names).toContain('basemap/basemap.pmtiles');
    expect(names).toContain('basemap/style.json');
    expect(names).toContain('basemap/sprite.png');
    expect(names.some((name) => name.includes('/glyphs/'))).toBe(true);
  });

  it('never changes the active pointer or the inactive slot when preparation fails', async () => {
    const { dataRoot, platform } = await platformContext();
    const first = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    await platform.datasets.activateSnapshot(first);
    const pointerBefore = await readPointer(dataRoot);

    // A platform over the same storage that uses the external tile tool. The tool requires an
    // operator-supplied extract, so naming one that does not exist fails the preparation before
    // anything is built or promoted.
    const external = await createTestPlatform({ builder: 'external', dataRoot });
    contexts.push(external);
    await expect(
      external.platform.datasets.prepareUpdate({
        inputs: [
          {
            kind: 'region_extract',
            name: 'missing-extract',
            path: join(dataRoot, 'does-not-exist.osm.pbf'),
          },
        ],
        sourceName: 'missing-extract',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    expect(await readPointer(dataRoot)).toEqual(pointerBefore);
    // The inactive slot was never created, and no staging directory was left behind.
    await expect(stat(join(dataRoot, 'slots', 'green'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(join(dataRoot, 'tmp'))).resolves.toEqual([]);
    // The snapshot that is serving is untouched and still valid.
    await expect(platform.datasets.validateSnapshot(first)).resolves.toMatchObject({ valid: true });
  });
});

describe('validation gating', () => {
  it('reports every check and validates a freshly prepared snapshot', async () => {
    const { platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
    const report = await platform.datasets.validateSnapshot(id);

    expect(report.valid).toBe(true);
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const names = report.checks.map((check) => check.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'archive',
        'basemap_component',
        'bounds',
        'checksums',
        'glyphs',
        'label_languages',
        'manifest',
        'region',
        'sprites',
        'style',
      ]),
    );
  });

  it('refuses to activate a snapshot whose artifact was corrupted after preparation', async () => {
    const { dataRoot, platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });

    const stylePath = join(dataRoot, 'slots', 'blue', 'basemap', 'style.json');
    await writeFile(stylePath, '{"version":8,"corrupted":true}');

    const report = await platform.datasets.validateSnapshot(id);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name === 'checksums')?.status).toBe('failed');

    await expect(platform.datasets.activateSnapshot(id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(platform.atlas.basemap()).resolves.toMatchObject({
      availability: 'not_installed',
    });
  });

  it('refuses to activate a snapshot whose artifact is missing', async () => {
    const { dataRoot, platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
    await rm(join(dataRoot, 'slots', 'blue', 'basemap', 'sprite.png'));

    const report = await platform.datasets.validateSnapshot(id);
    expect(report.valid).toBe(false);
    await expect(platform.datasets.activateSnapshot(id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('refuses a snapshot whose region does not match the configured one', async () => {
    const { dataRoot, platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
    expect(await readManifest(dataRoot, 'blue')).toMatchObject({ region: 'iran' });

    // A second platform over the same storage, configured for a different region.
    const foreign = await createTestPlatform({ dataRoot, region: 'elsewhere' });
    contexts.push(foreign);

    const report = await foreign.platform.datasets.validateSnapshot(id);
    expect(report.valid).toBe(false);
    const regionCheck = report.checks.find((check) => check.name === 'region');
    expect(regionCheck?.status).toBe('failed');
    expect(regionCheck?.message).toContain('elsewhere');

    await expect(foreign.platform.datasets.activateSnapshot(id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // The snapshot is still perfectly valid for the region it was built for.
    await expect(platform.datasets.validateSnapshot(id)).resolves.toMatchObject({ valid: true });
  });

  it('reports a snapshot that does not exist rather than inventing one', async () => {
    const { platform } = await platformContext();
    await expect(
      platform.datasets.validateSnapshot('iran-20260101t000000000z-abcdef01' as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('activation and rollback', () => {
  it('activates atomically and keeps the previous snapshot available', async () => {
    const { dataRoot, platform } = await platformContext();

    const first = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    await platform.datasets.activateSnapshot(first);
    const second = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'second' });
    await platform.datasets.activateSnapshot(second);

    const pointer = await readPointer(dataRoot);
    expect(pointer).toMatchObject({ slot: 'green', snapshotId: second });
    expect(pointer.previous).toMatchObject({ slot: 'blue', snapshotId: first });
    // Both snapshots remain on disk, so a rollback has somewhere to go.
    expect(await readManifest(dataRoot, 'blue')).toMatchObject({ snapshotId: first });
    expect(await readManifest(dataRoot, 'green')).toMatchObject({ snapshotId: second });

    const listed = await platform.datasets.listSnapshots();
    expect(listed.map((entry) => entry.snapshotId).sort()).toEqual([first, second].sort());
    expect(listed.find((entry) => entry.snapshotId === second)?.active).toBe(true);
  });

  it('rolls back to the previous snapshot and republishes its resources', async () => {
    const { dataRoot, platform } = await platformContext();
    const first = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    await platform.datasets.activateSnapshot(first);
    const second = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'second' });
    await platform.datasets.activateSnapshot(second);

    await platform.datasets.rollback();

    expect(await readPointer(dataRoot)).toMatchObject({ slot: 'blue', snapshotId: first });
    await expect(platform.atlas.basemap()).resolves.toMatchObject({
      availability: 'ready',
      resourceUrl: `/maps/v1/${first}/basemap.pmtiles`,
    });
  });

  it('refuses to roll back when there is no previous snapshot', async () => {
    const { platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    await platform.datasets.activateSnapshot(id);

    await expect(platform.datasets.rollback()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('publishes no basemap until a snapshot is activated', async () => {
    const { platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });

    await expect(platform.atlas.basemap()).resolves.toEqual({
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    });
    await expect(platform.atlas.datasetStatus()).resolves.toMatchObject({
      state: 'not_installed',
    });

    await platform.datasets.activateSnapshot(id);
    await expect(platform.atlas.basemap()).resolves.toMatchObject({ availability: 'ready' });
  });

  it('reports a degraded dataset when the active pointer names a missing snapshot', async () => {
    const { dataRoot, platform } = await platformContext();
    const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
    await platform.datasets.activateSnapshot(id);
    await rm(join(dataRoot, 'slots', 'blue'), { force: true, recursive: true });

    await expect(platform.atlas.datasetStatus()).resolves.toMatchObject({ state: 'degraded' });
    // Truthfully unavailable rather than "never installed": a dataset is present but unusable.
    await expect(platform.atlas.basemap()).resolves.toMatchObject({
      availability: 'unavailable',
      reason: 'snapshot_missing',
    });
  });
});

describe('concurrency', () => {
  it('serialises preparations so two cannot interleave', async () => {
    const { platform } = await platformContext();

    const results = await Promise.allSettled([
      platform.datasets.prepareUpdate({ inputs: [], sourceName: 'a' }),
      platform.datasets.prepareUpdate({ inputs: [], sourceName: 'b' }),
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
  });

  it('releases the provisioning lock after a failure', async () => {
    const { platform } = await platformContext();
    await expect(platform.datasets.rollback()).rejects.toMatchObject({ code: 'CONFLICT' });
    // A later operation must not find a stale lock.
    await expect(
      platform.datasets.prepareUpdate({ inputs: [], sourceName: 'after' }),
    ).resolves.toBeTypeOf('string');
  });
});

describe('published slot permissions', () => {
  // Permission bits are only meaningful on POSIX hosts; the lifecycle assertions below are not.
  const posix = process.platform !== 'win32';

  it('keeps a staging tree private until it is published', async () => {
    const { dataRoot } = await platformContext();
    const staging = await new SnapshotStore(dataRoot).createStagingDirectory();

    // A preparation in flight is nobody else's business.
    if (posix) expect((await stat(staging)).mode & 0o777).toBe(0o700);
  });

  it('publishes a slot the serving user can enter', async () => {
    const { dataRoot, platform } = await platformContext();
    const snapshotId = await platform.datasets.prepareUpdate({
      inputs: [],
      sourceName: 'published',
    });
    const slotRoot = join(dataRoot, 'slots', 'blue');

    if (posix) {
      const mode = (await stat(slotRoot)).mode & 0o777;
      // `mkdtemp` stages at 0o700. A slot left that way is readable only by the operator who
      // built it, so the serving containers — which run as a different, non-root user — cannot
      // traverse into it and the dataset resolves as unavailable.
      expect(mode).toBe(PUBLISHED_SLOT_MODE);
      expect(mode).not.toBe(0o700);
      expect(mode & 0o005).toBe(0o005);
      // Readable, never writable, for anyone but the owner.
      expect(mode & 0o022).toBe(0);
    }

    // The payload the slot publishes is intact, and nothing was made executable.
    const manifest = await readManifest(dataRoot, 'blue');
    expect(manifest).toMatchObject({ snapshotId });
    const archive = join(slotRoot, 'basemap', 'basemap.pmtiles');
    const archiveStats = await stat(archive);
    expect(archiveStats.size).toBeGreaterThan(0);
    if (posix) expect(archiveStats.mode & 0o111).toBe(0);

    // The lifecycle is unchanged: the snapshot still validates, activates and resolves ready.
    const report = await platform.datasets.validateSnapshot(snapshotId);
    expect(report.valid).toBe(true);
    await platform.datasets.activateSnapshot(snapshotId);
    expect(await readPointer(dataRoot)).toMatchObject({ slot: 'blue', snapshotId });
    await expect(platform.atlas.datasetStatus()).resolves.toMatchObject({
      snapshotId,
      state: 'ready',
    });
    await expect(platform.atlas.basemap()).resolves.toMatchObject({ availability: 'ready' });
  });
});
