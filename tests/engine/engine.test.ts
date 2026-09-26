import { appendFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseReverseParameters, parseSearchParameters } from '@atlas-os/platform';

import type { SnapshotId } from '../../packages/atlas-os/src/contracts.js';
import { SyntheticTileBuilder } from '../../packages/atlas-os/src/internal/builders/synthetic.js';
import { EngineHostClient } from '../../packages/atlas-os/src/internal/search/client.js';
import { SYNTHETIC_ID_BASE } from '../../packages/atlas-os/src/internal/search/dump/synthetic.js';
import { engineServeCommand } from '../../packages/atlas-os/src/internal/search/host/engine.js';
import { SearchPipeline } from '../../packages/atlas-os/src/internal/search/pipeline.js';
import { LocalSearchToolRunner } from '../../packages/atlas-os/src/internal/search/runner.js';
import { SearchService } from '../../packages/atlas-os/src/internal/search/service.js';
import { readSearchToolConfig } from '../../packages/atlas-os/src/internal/search/tools.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { BasemapProvisioner } from '../../packages/atlas-os/src/provisioning.js';
import type { SnapshotManifestV2 } from '../../packages/atlas-os/src/snapshot.js';
import { freePort, startTestHost, type TestHost } from '../helpers/search-host.js';
import { FONT_PATH, LABEL_LANGUAGES, REGION_BOUNDS } from '../helpers/snapshot.js';

/**
 * The real search engine, end to end, with no stand-in anywhere: the production pipeline imports
 * the synthetic fixture with the pinned engine archive, seals it, selects probes by asking the real
 * engine, and the production host loads it from a read-only slot and answers Persian queries.
 *
 * Runs only under `pnpm test:engine` in local mode, which verifies the archive's pinned digest and
 * a Java runtime first. The embedded engine binds fixed loopback ports, so one engine runs at a
 * time on a machine; in Compose each host has its own network namespace.
 */
const ARCHIVE = process.env['ATLAS_SEARCH_ENGINE_ARCHIVE'];
const ENABLED = process.env['ATLAS_ENGINE_TEST_MODE'] === 'local' && ARCHIVE !== undefined;
const REPORT = process.env['ATLAS_ENGINE_TEST_REPORT'];

const ARABIC_KAF = String.fromCodePoint(0x0643);
const ARABIC_YEH = String.fromCodePoint(0x064a);
const PERSIAN_ONE = String.fromCodePoint(0x06f1);
const PERSIAN_TWO = String.fromCodePoint(0x06f2);

const measurements: Record<string, unknown> = {};

describe.skipIf(!ENABLED)('real search engine (local mode)', () => {
  let dataRoot: string;
  let store: SnapshotStore;
  let provisioner: BasemapProvisioner;
  let host: TestHost | undefined;
  const client = new EngineHostClient({ queryTimeoutMs: 10_000, statusTimeoutMs: 2_000 });

  beforeAll(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'atlas-os-engine-'));
    store = new SnapshotStore(dataRoot);
    const config = readSearchToolConfig(
      {
        ATLAS_SEARCH_BUILD_THREADS: '2',
        ATLAS_SEARCH_ENGINE_ARCHIVE: ARCHIVE,
        ATLAS_SEARCH_IMPORT_HEAP: '512m',
        ATLAS_SEARCH_TOOL_KIND: 'synthetic',
        ATLAS_SEARCH_TOOL_MODE: 'local',
      },
      'synthetic',
    );
    provisioner = new BasemapProvisioner({
      bounds: REGION_BOUNDS,
      builder: new SyntheticTileBuilder(),
      fontPath: FONT_PATH,
      labelLanguages: [...LABEL_LANGUAGES],
      region: 'iran',
      search: new SearchPipeline({ kind: 'synthetic', runner: new LocalSearchToolRunner(config) }),
      store,
    });
  });

  afterAll(async () => {
    client.close();
    await host?.close();
    await rm(dataRoot, { force: true, recursive: true });
    if (REPORT !== undefined) {
      await appendFile(REPORT, `${JSON.stringify(measurements)}\n`);
    }
  });

  async function startHost(): Promise<TestHost> {
    return startTestHost({
      config: { heap: '512m', pollMs: 250, startupTimeoutMs: 180_000 },
      dataRoot,
      engineCommand: engineServeCommand({
        engineArchive: ARCHIVE!,
        heap: '512m',
        javaExecutable: process.env['ATLAS_SEARCH_ENGINE_JAVA'] ?? 'java',
      }),
      enginePort: await freePort(),
      slot: 'blue',
    });
  }

  function service(): SearchService {
    return new SearchService({ client, engines: { blue: host!.url }, region: 'iran', store });
  }

  async function search(q: string, language: 'fa' | 'en' = 'fa') {
    const parsed = parseSearchParameters({ language: [language], q: [q] });
    if (!parsed.ok) throw new Error('invalid test query');
    return service().search(parsed.request);
  }

  it('prepares a sealed snapshot with probes chosen by the real engine', async () => {
    const started = performance.now();
    const id = await provisioner.prepare({ inputs: [], sourceName: 'engine-test' });
    measurements['prepareMilliseconds'] = Math.round(performance.now() - started);
    const manifest = (await store.readManifest('blue')) as SnapshotManifestV2;
    expect(manifest.snapshotId).toBe(id);
    expect(manifest.search.probes.length).toBeGreaterThan(0);
    expect(manifest.search.tools[0]).toMatchObject({ name: 'engine', version: '1.3.0' });
    measurements['engineTree'] = {
      bytes: manifest.search.engine.bytes,
      files: manifest.search.engine.files,
    };
    measurements['probes'] = manifest.search.probes;
    expect((await provisioner.validate(id as SnapshotId)).valid).toBe(true);
  });

  it('loads the slot read-only through the host and reloads when the slot is replaced', async () => {
    host = await startHost();
    const first = await host.ready();
    const firstStatus = await host.status();
    measurements['firstLoad'] = firstStatus.diagnostics;

    // Nothing is active yet, so the next preparation replaces this same slot.
    const second = await provisioner.prepare({ inputs: [], sourceName: 'engine-test-2' });
    const reloaded = await host.ready(first.loadId);
    expect(reloaded.snapshotId).toBe(second);
    expect(reloaded.loadId).not.toBe(first.loadId);
    await provisioner.activate(second as SnapshotId);
  });

  it('answers Persian and English queries through the guard', async () => {
    const tehran = await search('تهران');
    expect(tehran).toMatchObject({ outcome: 'ok' });
    if (tehran.outcome === 'ok') {
      expect(tehran.results[0]).toMatchObject({
        id: `osm:node:${SYNTHETIC_ID_BASE + 1}`,
        kind: 'city',
        name: 'تهران',
      });
    }

    const english = await search('Tehran', 'en');
    expect(english.outcome === 'ok' && english.results[0]).toMatchObject({
      id: `osm:node:${SYNTHETIC_ID_BASE + 1}`,
      name: 'Tehran',
    });

    // Arabic letter variants in the query and in the data both meet at the canonical form, and
    // the name is shown as it was mapped.
    for (const query of [`${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`, 'کتابخانه ملی']) {
      const library = await search(query);
      expect(library.outcome === 'ok' && library.results[0]).toMatchObject({
        id: `osm:node:${SYNTHETIC_ID_BASE + 10}`,
        name: `${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`,
      });
    }

    // Persian digits are searchable as ASCII and displayed as mapped.
    const house = await search(`خیابان آزادی ${PERSIAN_ONE}${PERSIAN_TWO}`);
    expect(house.outcome).toBe('ok');
    if (house.outcome === 'ok') {
      const found = house.results.find(
        (result) => result.id === `osm:node:${SYNTHETIC_ID_BASE + 9}`,
      );
      expect(found?.address['housenumber']).toBe(`${PERSIAN_ONE}${PERSIAN_TWO}`);
    }

    // The generation canary is never a result.
    const canary = await search('atlas-generation');
    expect(canary.outcome === 'ok' && canary.results).toEqual([]);
  });

  it('reverse geocodes a point address and ignores points outside the region', async () => {
    const parsed = parseReverseParameters({ lat: ['35.7002'], lon: ['51.3605'] });
    if (!parsed.ok) throw new Error('invalid test coordinate');
    const outcome = await service().reverse(parsed.request);
    expect(outcome.outcome === 'ok' && outcome.results[0]).toMatchObject({
      address: expect.objectContaining({ housenumber: `${PERSIAN_ONE}${PERSIAN_TWO}` }),
      id: `osm:node:${SYNTHETIC_ID_BASE + 9}`,
    });
    const outside = await service().reverse({
      coordinate: { latitude: 10, longitude: 10 },
      language: 'fa',
    });
    expect(outside).toMatchObject({ outcome: 'ok', results: [] });
  });

  it('never writes to the sealed slot, and a restarted host has a new identity', async () => {
    const manifest = (await store.readManifest('blue')) as SnapshotManifestV2;
    const slotEngine = join(store.slotRoot('blue'), 'search', 'engine');
    const tree = await listTree(slotEngine);
    expect(tree.digest).toBe(manifest.search.engine.treeDigest);
    expect(tree.files).toBe(manifest.search.engine.files);

    const before = await host!.ready();
    const status = await host!.status();
    measurements['servingDiagnostics'] = status.diagnostics;
    await host!.close();
    host = await startHost();
    const after = await host.ready();
    expect(after.loadId).not.toBe(before.loadId);
    expect(after.snapshotId).toBe(before.snapshotId);
    expect(await search('تهران')).toMatchObject({ outcome: 'ok' });
    expect((await listTree(slotEngine)).digest).toBe(manifest.search.engine.treeDigest);
    expect(await readdir(join(host.workRoot, 'trees'))).toHaveLength(1);
  });
});
