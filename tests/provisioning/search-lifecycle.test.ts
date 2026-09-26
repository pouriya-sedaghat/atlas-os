import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SnapshotId } from '../../packages/atlas-os/src/contracts.js';
import { resolveInputs } from '../../packages/atlas-os/src/internal/builders/external.js';
import { SyntheticTileBuilder } from '../../packages/atlas-os/src/internal/builders/synthetic.js';
import type {
  BasemapBuildRequest,
  BasemapBuildResult,
  BasemapTileBuilder,
} from '../../packages/atlas-os/src/internal/builders/types.js';
import { resolveDataset } from '../../packages/atlas-os/src/internal/basemap/availability.js';
import { EngineHostClient } from '../../packages/atlas-os/src/internal/search/client.js';
import { SYNTHETIC_ID_BASE } from '../../packages/atlas-os/src/internal/search/dump/synthetic.js';
import { SearchPipeline } from '../../packages/atlas-os/src/internal/search/pipeline.js';
import { SearchService } from '../../packages/atlas-os/src/internal/search/service.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { BasemapProvisioner } from '../../packages/atlas-os/src/provisioning.js';
import type { SnapshotManifest, SnapshotManifestV2 } from '../../packages/atlas-os/src/snapshot.js';
import { FakeSearchTools } from '../helpers/fake-search-tools.js';
import { startTestHost } from '../helpers/search-host.js';
import { FONT_PATH, LABEL_LANGUAGES, REGION_BOUNDS } from '../helpers/snapshot.js';

/**
 * The search half of the dataset lifecycle, end to end through the production provisioner:
 * export, post-process, canary, import, seal, probe selection, schema-2 manifest, validation,
 * promotion, activation, rollback across schema versions, and a host loading the result. The
 * engine and its tools are stand-ins here; the engine tests run the same path on the real ones.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

/** Tiles from the synthetic builder, with the extract resolved and hashed as production does. */
class ExtractTileBuilder implements BasemapTileBuilder {
  readonly id = 'extract-test';
  readonly #tiles = new SyntheticTileBuilder();

  async build(request: BasemapBuildRequest): Promise<BasemapBuildResult> {
    const resolved = await resolveInputs(request.inputs, ['osm']);
    const tiles = await this.#tiles.build(request);
    return { ...tiles, inputs: resolved.map((entry) => entry.provenance) };
  }
}

interface Harness {
  readonly dataRoot: string;
  readonly store: SnapshotStore;
  readonly tools: FakeSearchTools;
  provisioner(options?: {
    readonly search?: 'external' | 'synthetic' | 'none';
    readonly clock?: () => Date;
  }): BasemapProvisioner;
}

async function harness(): Promise<Harness> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'atlas-os-search-lifecycle-'));
  roots.push(dataRoot);
  const store = new SnapshotStore(dataRoot);
  const tools = new FakeSearchTools();
  return {
    dataRoot,
    provisioner: (options = {}) => {
      const kind = options.search ?? 'synthetic';
      return new BasemapProvisioner({
        bounds: REGION_BOUNDS,
        builder: kind === 'external' ? new ExtractTileBuilder() : new SyntheticTileBuilder(),
        fontPath: FONT_PATH,
        labelLanguages: [...LABEL_LANGUAGES],
        region: 'iran',
        search:
          kind === 'none'
            ? undefined
            : new SearchPipeline({
                kind,
                runner: tools,
                ...(options.clock === undefined ? {} : { clock: options.clock }),
              }),
        store,
      });
    },
    store,
    tools,
  };
}

async function manifestOf(store: SnapshotStore, id: string): Promise<SnapshotManifest> {
  const slot = (await store.findSlot(id))!;
  return (await store.readManifest(slot))!;
}

async function extract(harnessRoot: string): Promise<string> {
  const path = join(harnessRoot, '..', `${harnessRoot.split(/[\\/]/).pop()}-region.osm.pbf`);
  await writeFile(path, 'a deterministic stand-in for an extract');
  roots.push(path);
  return path;
}

describe('search provisioning', () => {
  it('builds a sealed, validated schema-2 snapshot from the synthetic fixture', async () => {
    const { dataRoot, provisioner, store, tools } = await harness();
    const id = await provisioner().prepare({ inputs: [], sourceName: 'fixture' });
    const manifest = (await manifestOf(store, id)) as SnapshotManifestV2;

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.components).toEqual({ basemap: 'ready', search: 'ready' });
    expect(tools.calls).toEqual(['importDump', 'selectProbes']);
    const { search } = manifest;
    expect(search.source.kind).toBe('synthetic');
    expect(search.attribution.licence).toBe('none');
    expect(search.dump).toMatchObject({ documents: 10, places: 10 });
    expect(search.dump.variants).toEqual({ addresses: 0, housenumbers: 1, names: 1, postcodes: 0 });
    expect(search.probes).toEqual(
      expect.arrayContaining([
        {
          expectId: `osm:node:${SYNTHETIC_ID_BASE + 1}`,
          language: 'fa',
          query: 'تهران',
          type: 'search',
        },
        expect.objectContaining({ expectId: `osm:node:${SYNTHETIC_ID_BASE + 9}`, type: 'reverse' }),
      ]),
    );
    expect(
      search.probes.filter((probe) => probe.type === 'search' && probe.language === 'fa'),
    ).toHaveLength(3);
    expect(Date.parse(search.engine.importDate)).toBeLessThanOrEqual(
      Date.parse(manifest.createdAt),
    );

    // Sealed: no run-time output, recorded exactly, and nothing left from the build.
    const slotRoot = store.slotRoot((await store.findSlot(id))!);
    const tree = await listTree(join(slotRoot, 'search', 'engine'));
    expect(tree.digest).toBe(search.engine.treeDigest);
    expect(tree.entries.some((entry) => entry.path.endsWith('/logs'))).toBe(false);
    expect(await readdir(slotRoot)).toEqual(['basemap', 'manifest.json', 'search']);
    expect(await readdir(join(dataRoot, 'tmp'))).toEqual([]);

    const report = await provisioner().validate(id as SnapshotId);
    expect(report.valid).toBe(true);
  });

  it('is served by a host after activation', async () => {
    const { dataRoot, provisioner, store } = await harness();
    const id = await provisioner().prepare({ inputs: [], sourceName: 'fixture' });
    await provisioner().activate(id);
    const host = await startTestHost({ dataRoot, slot: 'blue' });
    const client = new EngineHostClient();
    try {
      await host.ready();
      const service = new SearchService({
        client,
        engines: { blue: host.url },
        region: 'iran',
        store,
      });
      const outcome = await service.search({ language: 'fa', limit: 5, query: 'کتابخانه ملی' });
      expect(outcome).toMatchObject({ outcome: 'ok', snapshotId: id });
      if (outcome.outcome === 'ok') {
        // Found through the canonical variant; shown with the name as it was mapped.
        expect(outcome.results[0]?.id).toBe(`osm:node:${SYNTHETIC_ID_BASE + 10}`);
        expect(outcome.results[0]?.name).toBe(
          `${String.fromCodePoint(0x0643)}تابخانه مل${String.fromCodePoint(0x064a)}`,
        );
      }
      const status = await service.activeStatus(await resolveDataset(store, 'iran'));
      expect(status).toEqual({ snapshotId: id, state: 'ready' });
    } finally {
      client.close();
      await host.close();
    }
  });

  it('builds search from the same extract as the basemap', async () => {
    const { dataRoot, provisioner, store, tools } = await harness();
    const path = await extract(dataRoot);
    const id = await provisioner({ search: 'external' }).prepare({
      inputs: [{ kind: 'region_extract', name: 'region', path }],
      sourceName: 'region',
      sourceTimestamp: '2026-09-01T00:00:00.000Z',
    });
    const manifest = (await manifestOf(store, id)) as SnapshotManifestV2;
    expect(tools.calls).toEqual(['buildDump', 'importDump', 'selectProbes']);
    expect(manifest.search.source).toEqual({
      bytes: manifest.inputs[0]!.bytes,
      checksum: manifest.inputs[0]!.checksum,
      kind: 'region_extract',
    });
    expect(manifest.search.attribution.licence).toBe('ODbL-1.0');
    expect(manifest.search.tools).toEqual(tools.tools);
    // No host path is recorded anywhere in the manifest.
    const text = await readFile(join(store.slotRoot('blue'), 'manifest.json'), 'utf8');
    expect(text).not.toContain(dataRoot);
    expect(text).not.toContain(path);
    expect((await provisioner({ search: 'external' }).validate(id)).valid).toBe(true);
  });

  it('refuses a preparation whose extract changed while the tools were reading it', async () => {
    const { dataRoot, provisioner, tools } = await harness();
    const path = await extract(dataRoot);
    tools.onBuildDump = (file) => appendFile(file, ' changed');
    await expect(
      provisioner({ search: 'external' }).prepare({
        inputs: [{ kind: 'region_extract', name: 'region', path }],
        sourceName: 'region',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readdir(join(dataRoot, 'tmp'))).toEqual([]);
    await expect(stat(join(dataRoot, 'slots', 'blue'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a private staging tree when the database stop was not confirmed', async () => {
    const { dataRoot, provisioner, store, tools } = await harness();
    const path = await extract(dataRoot);
    tools.onBuildDump = async (_extract, workDirectory) => {
      const database = join(workDirectory, 'database');
      await mkdir(join(database, 'pg'), { recursive: true });
      await writeFile(join(database, 'cluster-unverified'), '');
      await writeFile(join(database, 'pg', 'postmaster.pid'), 'still potentially running');
      throw new Error('database stop failed');
    };

    await expect(
      provisioner({ search: 'external' }).prepare({
        inputs: [{ kind: 'region_extract', name: 'region', path }],
        sourceName: 'region',
      }),
    ).rejects.toThrow('database stop failed');

    const entries = await readdir(join(dataRoot, 'tmp'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^prepare-/);
    await expect(
      stat(join(dataRoot, 'tmp', entries[0]!, 'search-work', 'database', 'pg', 'postmaster.pid')),
    ).resolves.toBeDefined();
    expect(await store.readActivePointer()).toBeUndefined();
    await expect(stat(store.slotRoot('blue'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['the import fails', (tools: FakeSearchTools) => (tools.failImport = true)],
    ['the database answers no probe', (tools: FakeSearchTools) => (tools.emptyIndex = true)],
  ])('leaves no trace when %s', async (_label, sabotage) => {
    const { dataRoot, provisioner, store, tools } = await harness();
    const first = await provisioner().prepare({ inputs: [], sourceName: 'first' });
    await provisioner().activate(first);
    const pointer = await readFile(store.activePointerPath);
    sabotage(tools);
    await expect(provisioner().prepare({ inputs: [], sourceName: 'second' })).rejects.toThrow();
    expect(await readFile(store.activePointerPath)).toEqual(pointer);
    expect(await readdir(join(dataRoot, 'tmp'))).toEqual([]);
    await expect(stat(join(dataRoot, 'slots', 'green'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never gives the two slots the same engine import instant', async () => {
    const { provisioner, store } = await harness();
    const fixed = new Date('2026-09-24T12:00:00.000Z');
    const a = await provisioner({ clock: () => fixed }).prepare({ inputs: [], sourceName: 'a' });
    await provisioner().activate(a);
    const b = await provisioner({ clock: () => fixed }).prepare({ inputs: [], sourceName: 'b' });
    const first = ((await manifestOf(store, a)) as SnapshotManifestV2).search.engine.importDate;
    const second = ((await manifestOf(store, b)) as SnapshotManifestV2).search.engine.importDate;
    expect(first).toBe('2026-09-24T12:00:00.000Z');
    expect(second).toBe('2026-09-24T12:00:00.001Z');
  });

  it('activates and rolls back across schema versions without rewriting either', async () => {
    const { provisioner, store } = await harness();
    const v1 = await provisioner({ search: 'none' }).prepare({ inputs: [], sourceName: 'v1' });
    expect((await manifestOf(store, v1)).schemaVersion).toBe(1);
    await provisioner().activate(v1);
    const v1Bytes = await readFile(store.manifestPath('blue'));

    const v2 = await provisioner().prepare({ inputs: [], sourceName: 'v2' });
    expect((await manifestOf(store, v2)).schemaVersion).toBe(2);
    await provisioner().activate(v2);
    expect(await store.readActivePointer()).toMatchObject({ schemaVersion: 1, snapshotId: v2 });

    await provisioner().rollback();
    const pointer = await store.readActivePointer();
    expect(pointer).toMatchObject({ schemaVersion: 1, slot: 'blue', snapshotId: v1 });
    expect(await readFile(store.manifestPath('blue'))).toEqual(v1Bytes);

    await provisioner().activate(v2);
    expect((await store.readActivePointer())?.snapshotId).toBe(v2);
  });
});
