import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseReverseParameters, parseSearchParameters } from '@atlas-os/platform';

import type { SnapshotId } from '../../packages/atlas-os/src/contracts.js';
import { resolveInputs } from '../../packages/atlas-os/src/internal/builders/external.js';
import { SyntheticTileBuilder } from '../../packages/atlas-os/src/internal/builders/synthetic.js';
import type {
  BasemapBuildRequest,
  BasemapBuildResult,
  BasemapTileBuilder,
} from '../../packages/atlas-os/src/internal/builders/types.js';
import { sha256File } from '../../packages/atlas-os/src/internal/fs/checksum.js';
import { EngineHostClient } from '../../packages/atlas-os/src/internal/search/client.js';
import { engineServeCommand } from '../../packages/atlas-os/src/internal/search/host/engine.js';
import { SearchPipeline } from '../../packages/atlas-os/src/internal/search/pipeline.js';
import { createSearchToolRunner } from '../../packages/atlas-os/src/internal/search/runner.js';
import { SearchService } from '../../packages/atlas-os/src/internal/search/service.js';
import { readSearchToolConfig } from '../../packages/atlas-os/src/internal/search/tools.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { BasemapProvisioner } from '../../packages/atlas-os/src/provisioning.js';
import type { SnapshotManifestV2 } from '../../packages/atlas-os/src/snapshot.js';
import { cleanUp, removeContainer } from '../helpers/cleanup.js';
import { searchHostRunArguments, waitForContainerHost } from '../helpers/container-host.js';
import { encodeOsmPbf } from '../helpers/osm-pbf.js';
import { freePort, startTestHost, type TestHost } from '../helpers/search-host.js';
import { FONT_PATH, LABEL_LANGUAGES, REGION_BOUNDS } from '../helpers/snapshot.js';
import { TINY_OSM_IDS, tinyOsmData } from '../helpers/tiny-osm.js';

/**
 * The production search pipeline on a tiny, deterministic OpenStreetMap extract: the pinned
 * database builder in reverse-only mode with no updates, its export, the post-processor, the
 * pinned engine import, sealing, probe selection, and the production host serving the sealed
 * slot read-only, asked Persian and English questions whose answers are known in advance.
 *
 * Container mode runs the tools and the host in the repository's own images, with no network.
 * Local mode runs the same build script against database tools installed on this machine.
 * The basemap half uses synthetic tiles over the same extract: the tile tool's own contract is
 * covered by the basemap tests, and its ancillary inputs are not part of this fixture.
 */
const MODE = process.env['ATLAS_ENGINE_TEST_MODE'];
const LOCAL = MODE === 'local' && process.env['ATLAS_SEARCH_BUILD_SCRIPT'] !== undefined;
const CONTAINER = MODE === 'container';
const REPORT = process.env['ATLAS_ENGINE_TEST_REPORT'];

const PERSIAN_FOUR = String.fromCodePoint(0x06f4);
const PERSIAN_FIVE = String.fromCodePoint(0x06f5);
const ZWNJ = String.fromCodePoint(0x200c);
const ARABIC_KAF = String.fromCodePoint(0x0643);
const ARABIC_YEH = String.fromCodePoint(0x064a);

/** Tiles from the synthetic builder; the extract resolved and hashed exactly as in production. */
class ExtractTileBuilder implements BasemapTileBuilder {
  readonly id = 'extract-pipeline-test';
  readonly #tiles = new SyntheticTileBuilder();

  async build(request: BasemapBuildRequest): Promise<BasemapBuildResult> {
    const resolved = await resolveInputs(request.inputs, ['osm']);
    return {
      ...(await this.#tiles.build(request)),
      inputs: resolved.map((entry) => entry.provenance),
    };
  }
}

/** The production host in its own image; see `searchHostRunArguments` for its constraints. */
async function startContainerHost(
  dataRoot: string,
): Promise<{ name: string; url: URL; close(): void }> {
  const port = await freePort();
  const name = `atlas-os-engine-test-${process.pid}`;
  const run = spawnSync('docker', searchHostRunArguments({ dataRoot, name, port }));
  if (run.status !== 0) {
    const failure = new Error(`host container failed to start: ${run.stderr}`);
    // A run can fail after the container was created; none is left behind either way.
    try {
      removeContainer(name, { missingOk: true });
    } catch (cleanup) {
      throw new AggregateError([failure, cleanup], failure.message);
    }
    throw failure;
  }
  return {
    close: () => removeContainer(name),
    name,
    url: new URL(`http://127.0.0.1:${port}/`),
  };
}

describe.skipIf(!LOCAL && !CONTAINER)('tiny extract through the production search pipeline', () => {
  const measurements: Record<string, unknown> = { mode: MODE };
  let root: string;
  let dataRoot: string;
  let extract: string;
  let store: SnapshotStore;
  let snapshotId: string;
  let host: TestHost | undefined;
  let containerHost: { name: string; url: URL; close(): void } | undefined;
  const client = new EngineHostClient({ queryTimeoutMs: 10_000, statusTimeoutMs: 2_000 });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-os-pipeline-'));
    dataRoot = join(root, 'data');
    extract = join(root, 'region.osm.pbf');
    await writeFile(extract, encodeOsmPbf(tinyOsmData()));
    store = new SnapshotStore(dataRoot);
  });

  // Every step runs; any failure, including a container that cannot be removed, fails the suite.
  afterAll(() =>
    cleanUp([
      () => client.close(),
      () => host?.close(),
      () => containerHost?.close(),
      () => rm(root, { force: true, recursive: true }),
      () =>
        REPORT === undefined ? undefined : appendFile(REPORT, `${JSON.stringify(measurements)}\n`),
    ]),
  );

  function hostUrl(): URL {
    return containerHost?.url ?? host!.url;
  }

  async function search(q: string, language: 'fa' | 'en' = 'fa') {
    const parsed = parseSearchParameters({ language: [language], limit: ['10'], q: [q] });
    if (!parsed.ok) throw new Error('invalid test query');
    const service = new SearchService({
      client,
      engines: { blue: hostUrl() },
      region: 'iran',
      store,
    });
    const outcome = await service.search(parsed.request);
    expect(outcome.outcome, q).toBe('ok');
    return outcome.outcome === 'ok' ? outcome.results : [];
  }

  it('prepares, seals and validates a snapshot from the extract', async () => {
    const environment = {
      ATLAS_SEARCH_BUILD_SCRIPT: process.env['ATLAS_SEARCH_BUILD_SCRIPT'],
      ATLAS_SEARCH_BUILD_THREADS: '2',
      ATLAS_SEARCH_ENGINE_ARCHIVE: process.env['ATLAS_SEARCH_ENGINE_ARCHIVE'],
      ATLAS_SEARCH_IMPORT_HEAP: '512m',
      ATLAS_SEARCH_TOOL_KIND: 'external',
      ATLAS_SEARCH_TOOL_MODE: CONTAINER ? 'container' : 'local',
    };
    const provisioner = new BasemapProvisioner({
      bounds: REGION_BOUNDS,
      builder: new ExtractTileBuilder(),
      fontPath: FONT_PATH,
      labelLanguages: [...LABEL_LANGUAGES],
      region: 'iran',
      search: new SearchPipeline({
        kind: 'external',
        runner: createSearchToolRunner(readSearchToolConfig(environment, 'external')),
      }),
      store,
    });
    const started = performance.now();
    snapshotId = await provisioner.prepare({
      inputs: [{ kind: 'region_extract', name: 'tiny-fixture', path: extract }],
      sourceName: 'tiny-fixture',
      sourceTimestamp: '2026-09-01T00:00:00.000Z',
    });
    measurements['prepareMilliseconds'] = Math.round(performance.now() - started);
    await provisioner.activate(snapshotId as SnapshotId);

    const manifest = (await store.readManifest('blue')) as SnapshotManifestV2;
    expect(manifest.search.source).toEqual({
      bytes: manifest.inputs[0]!.bytes,
      checksum: await sha256File(extract),
      kind: 'region_extract',
    });
    expect(manifest.search.attribution.licence).toBe('ODbL-1.0');
    measurements['dump'] = manifest.search.dump;
    measurements['engine'] = manifest.search.engine;
    measurements['probes'] = manifest.search.probes;
    expect((await provisioner.validate(snapshotId as SnapshotId)).valid).toBe(true);
  });

  it('serves the sealed slot through the host', async () => {
    if (CONTAINER) {
      const started = await startContainerHost(dataRoot);
      containerHost = started;
      // A host that exits fails here at once, with its state and output; `afterAll` removes it.
      await waitForContainerHost({
        name: started.name,
        ready: async () => {
          const status = await client.status(started.url);
          return status.kind === 'ok' && status.value.state === 'ready';
        },
        timeoutMs: 300_000,
      });
    } else {
      host = await startTestHost({
        config: { heap: '512m', startupTimeoutMs: 180_000 },
        dataRoot,
        engineCommand: engineServeCommand({
          engineArchive: process.env['ATLAS_SEARCH_ENGINE_ARCHIVE']!,
          heap: '512m',
          javaExecutable: process.env['ATLAS_SEARCH_ENGINE_JAVA'] ?? 'java',
        }),
        enginePort: await freePort(),
        slot: 'blue',
      });
      const load = await host.ready();
      expect(load.snapshotId).toBe(snapshotId);
      measurements['host'] = (await host.status()).diagnostics;
    }
  });

  it('answers Persian questions whose answers are known in advance', async () => {
    expect((await search('تهران')).map((result) => result.id)).toContain(TINY_OSM_IDS.tehran);
    expect((await search('شیراز')).map((result) => result.id)).toContain(TINY_OSM_IDS.shiraz);

    // The same street name in two cities stays two results; its two Tehran segments are one.
    const azadi = await search('خیابان آزادی');
    const streets = azadi.filter((result) => result.category === 'highway:primary');
    expect(streets.map((result) => result.address['city']).sort()).toEqual(['تهران', 'شیراز']);

    for (const query of [`${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`, 'کتابخانه ملی']) {
      expect((await search(query))[0]?.id, query).toBe(TINY_OSM_IDS.library);
    }
    expect((await search(`کتاب${ZWNJ}فروشی ققنوس`))[0]?.id).toBe(TINY_OSM_IDS.bookshop);
    expect((await search('برج میلاد'))[0]?.id).toBe(TINY_OSM_IDS.milad);
    expect((await search('Milad Tower', 'en'))[0]).toMatchObject({
      id: TINY_OSM_IDS.milad,
      name: 'Milad Tower',
    });

    const house = (await search(`خیابان آزادی ${PERSIAN_FOUR}${PERSIAN_FIVE}`)).find(
      (result) => result.id === TINY_OSM_IDS.house45,
    );
    expect(house?.address['housenumber']).toBe(`${PERSIAN_FOUR}${PERSIAN_FIVE}`);
  });

  it('reverse geocodes a point address with its postcode', async () => {
    const parsed = parseReverseParameters({ lat: ['35.7002'], lon: ['51.3605'] });
    if (!parsed.ok) throw new Error('invalid test coordinate');
    const service = new SearchService({
      client,
      engines: { blue: hostUrl() },
      region: 'iran',
      store,
    });
    const outcome = await service.reverse(parsed.request);
    expect(outcome.outcome === 'ok' && outcome.results[0]).toMatchObject({
      address: expect.objectContaining({ housenumber: '12', street: 'خیابان آزادی' }),
      id: TINY_OSM_IDS.house12,
    });
    measurements['reverse'] = outcome.outcome === 'ok' ? outcome.results[0] : outcome;
  });

  it('left the sealed slot byte for byte unchanged', async () => {
    const manifest = (await store.readManifest('blue')) as SnapshotManifestV2;
    const tree = await listTree(join(store.slotRoot('blue'), 'search', 'engine'));
    expect(tree.digest).toBe(manifest.search.engine.treeDigest);
    expect(tree.bytes).toBe(manifest.search.engine.bytes);
  });
});
