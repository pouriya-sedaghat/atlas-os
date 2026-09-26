import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlaceQueryOutcome, SnapshotId } from '../../packages/atlas-os/src/contracts.js';
import { resolveDataset } from '../../packages/atlas-os/src/internal/basemap/availability.js';
import { EngineHostClient } from '../../packages/atlas-os/src/internal/search/client.js';
import { SearchService } from '../../packages/atlas-os/src/internal/search/service.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';
import {
  addSearchComponent,
  remark,
  type FakePlace,
  type SearchComponentOptions,
} from '../helpers/search-snapshot.js';
import { startTestHost, waitFor, type TestHost } from '../helpers/search-host.js';

/**
 * Adversarial tests of the search guard: the API's search service against two real per-slot
 * hosts, each running an engine stand-in as a child process. Every generation's places carry
 * identifiers unique to it, so an answer from the wrong generation is detectable. The host fence
 * is zero throughout: correctness never depends on elapsed time.
 */

const BASE = 8_000_000_000_000_000;

function generation(offset: number, label: string): SearchComponentOptions {
  const places: FakePlace[] = [
    {
      coordinates: [51.389, 35.6892],
      names: { en: `Tehran ${label}`, fa: 'تهران' },
      osm_id: BASE + offset + 1,
      osm_key: 'place',
      osm_type: 'N',
      osm_value: 'city',
      type: 'city',
    },
    {
      coordinates: [51.3605, 35.7002],
      housenumber: '12',
      osm_id: BASE + offset + 9,
      osm_key: 'place',
      osm_type: 'N',
      osm_value: 'house',
      type: 'house',
    },
  ];
  return {
    places,
    probes: [
      {
        expectId: `osm:node:${BASE + offset + 1}`,
        language: 'fa',
        query: 'تهران',
        type: 'search',
      },
    ],
  };
}

interface World {
  readonly context: TestPlatform;
  readonly store: SnapshotStore;
  readonly service: SearchService;
  readonly client: EngineHostClient;
  readonly blue: TestHost;
  readonly green: TestHost;
  readonly a: SnapshotId;
  readonly b: SnapshotId;
  /** Identifiers each snapshot's engine may legitimately answer with. */
  readonly owned: ReadonlyMap<string, ReadonlySet<string>>;
}

let world: World;

async function prepare(
  context: TestPlatform,
  store: SnapshotStore,
  options: SearchComponentOptions,
): Promise<SnapshotId> {
  const snapshotId = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'fixture',
  });
  const slot = (await store.findSlot(snapshotId))!;
  await addSearchComponent(join(context.dataRoot, 'slots', slot), undefined, options);
  return snapshotId;
}

beforeEach(async () => {
  const context = await createTestPlatform();
  const store = new SnapshotStore(context.dataRoot);
  const a = await prepare(context, store, generation(0, 'A'));
  await context.platform.datasets.activateSnapshot(a);
  const b = await prepare(context, store, generation(100, 'B'));
  const blue = await startTestHost({ dataRoot: context.dataRoot, slot: 'blue' });
  const green = await startTestHost({ dataRoot: context.dataRoot, slot: 'green' });
  await Promise.all([blue.ready(), green.ready()]);
  const client = new EngineHostClient();
  const service = new SearchService({
    client,
    engines: { blue: blue.url, green: green.url },
    region: 'iran',
    store,
  });
  const ids = (offset: number) =>
    new Set([`osm:node:${BASE + offset + 1}`, `osm:node:${BASE + offset + 9}`]);
  world = {
    a,
    b,
    blue,
    client,
    context,
    green,
    owned: new Map([
      [a, ids(0)],
      [b, ids(100)],
    ]),
    service,
    store,
  };
});

afterEach(async () => {
  world.client.close();
  await Promise.all([world.blue.close(), world.green.close()]);
  await world.context.cleanup();
});

function search(): Promise<PlaceQueryOutcome> {
  return world.service.search({ language: 'en', limit: 5, query: 'تهران' });
}

/** An answer is stale when any result belongs to a generation other than the one it names. */
function stale(outcome: PlaceQueryOutcome): boolean {
  if (outcome.outcome !== 'ok') return false;
  const owned = world.owned.get(outcome.snapshotId)!;
  return outcome.results.some((result) => !owned.has(result.id));
}

async function held(host: TestHost): Promise<void> {
  await waitFor(async () => ((await host.control('state')).held > 0 ? true : undefined));
}

describe('search generation guard', () => {
  it('answers from the active generation and reports the standby engine ready', async () => {
    const outcome = await search();
    expect(outcome).toMatchObject({ outcome: 'ok', snapshotId: world.a });
    expect(stale(outcome)).toBe(false);
    if (outcome.outcome === 'ok') {
      expect(outcome.results[0]).toMatchObject({ id: `osm:node:${BASE + 1}`, name: 'Tehran A' });
      expect(outcome.attribution.licence).toBe('none');
    }
    const resolution = await resolveDataset(world.store, 'iran');
    expect(await world.service.standby(resolution)).toEqual({
      search: { snapshotId: world.b, state: 'ready' },
      snapshotId: world.b,
    });
  });

  it('refuses an answer that was in flight across an activation', async () => {
    await world.blue.control('hold');
    const inFlight = search();
    await held(world.blue);
    await world.context.platform.datasets.activateSnapshot(world.b);
    await world.blue.control('release');
    const outcome = await inFlight;
    expect(outcome).toMatchObject({ outcome: 'unavailable', reason: 'dataset_changed' });

    const after = await search();
    expect(after).toMatchObject({ outcome: 'ok', snapshotId: world.b });
    expect(stale(after)).toBe(false);
  });

  it('refuses an answer that was in flight across a rollback', async () => {
    await world.context.platform.datasets.activateSnapshot(world.b);
    await world.green.control('hold');
    const inFlight = search();
    await held(world.green);
    await world.context.platform.datasets.rollback();
    await world.green.control('release');
    expect(await inFlight).toMatchObject({ outcome: 'unavailable', reason: 'dataset_changed' });
    expect(await search()).toMatchObject({ outcome: 'ok', snapshotId: world.a });
  });

  it('detects a rapid A to B to A flip even though the same slot serves before and after', async () => {
    await world.blue.control('hold');
    const inFlight = search();
    await held(world.blue);
    await world.context.platform.datasets.activateSnapshot(world.b);
    await world.context.platform.datasets.rollback();
    expect((await world.store.readActivePointer())?.snapshotId).toBe(world.a);
    await world.blue.control('release');
    expect(await inFlight).toMatchObject({ outcome: 'unavailable', reason: 'dataset_changed' });
  });

  it('never returns an answer from a host that restarted mid-query', async () => {
    const before = await world.blue.ready();
    await world.blue.control('hold');
    const inFlight = search();
    await held(world.blue);
    await world.blue.host.close();
    const outcome = await inFlight;
    expect(outcome.outcome).toBe('unavailable');
    expect(stale(outcome)).toBe(false);

    const restarted = await startTestHost({
      dataRoot: world.context.dataRoot,
      slot: 'blue',
      workRoot: world.blue.workRoot,
    });
    try {
      const service = new SearchService({
        client: world.client,
        engines: { blue: restarted.url, green: world.green.url },
        region: 'iran',
        store: world.store,
      });
      const load = await restarted.ready();
      expect(load.loadId).not.toBe(before.loadId);
      const after = await service.search({ language: 'en', limit: 5, query: 'تهران' });
      expect(after).toMatchObject({ outcome: 'ok', snapshotId: world.a });
    } finally {
      await restarted.close();
    }
  });

  it('fails closed on a generation the engine is not serving', async () => {
    // The host does not notice the change for a long time, so the guard alone must catch it.
    await world.blue.close();
    const slow = await startTestHost({
      config: { pollMs: 60_000 },
      dataRoot: world.context.dataRoot,
      slot: 'blue',
    });
    try {
      await slow.ready();
      const service = new SearchService({
        client: world.client,
        engines: { blue: slow.url },
        region: 'iran',
        store: world.store,
      });
      expect(await service.search({ language: 'fa', limit: 5, query: 'تهران' })).toMatchObject({
        outcome: 'ok',
      });

      const manifestPath = join(world.store.slotRoot('blue'), 'manifest.json');
      const { readFile, writeFile } = await import('node:fs/promises');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Parameters<
        typeof remark
      >[0];
      manifest.search.dump['sha256'] = `sha256:${'9'.repeat(64)}`;
      remark(manifest);
      await writeFile(manifestPath, JSON.stringify(manifest));

      expect(await service.search({ language: 'fa', limit: 5, query: 'تهران' })).toMatchObject({
        outcome: 'unavailable',
        reason: 'generation_mismatch',
        retryable: true,
      });
      const resolution = await resolveDataset(world.store, 'iran');
      expect(await service.activeStatus(resolution)).toMatchObject({
        reason: 'generation_mismatch',
        state: 'unavailable',
      });
    } finally {
      await slow.close();
    }
  });

  it('reports a standby slot whose host is not answering as starting', async () => {
    await world.green.close();
    const resolution = await resolveDataset(world.store, 'iran');
    expect(await world.service.standby(resolution)).toEqual({
      search: { reason: 'starting', retryable: true, state: 'unavailable' },
      snapshotId: world.b,
    });
  });

  it('keeps stale answers at zero under concurrent queries and repeated flips', async () => {
    let ok = 0;
    let staleCount = 0;
    const refusals = new Map<string, number>();
    let flipping = true;

    const flips = (async () => {
      for (let round = 0; round < 8; round += 1) {
        await world.context.platform.datasets.activateSnapshot(round % 2 === 0 ? world.b : world.a);
      }
      flipping = false;
    })();
    const worker = async (offset: number) => {
      for (let index = 0; flipping || index < 20; index += 1) {
        const outcome =
          (index + offset) % 2 === 0
            ? await search()
            : await world.service.reverse({
                coordinate: { latitude: 35.7002, longitude: 51.3605 },
                language: 'fa',
              });
        if (stale(outcome)) staleCount += 1;
        if (outcome.outcome === 'ok') ok += 1;
        else {
          const reason = outcome.outcome === 'unavailable' ? outcome.reason : outcome.outcome;
          refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
        }
      }
    };
    await Promise.all([flips, worker(0), worker(1), worker(2), worker(3)]);

    expect(staleCount).toBe(0);
    expect(ok).toBeGreaterThan(0);
    // Every refusal is a typed, retryable guard outcome; nothing failed upstream.
    for (const reason of refusals.keys()) {
      expect(['dataset_changed', 'generation_mismatch']).toContain(reason);
    }
  });

  it('answers reverse lookups outside the bounds without asking the engine', async () => {
    await world.blue.close();
    const outcome = await world.service.reverse({
      coordinate: { latitude: 10, longitude: 10 },
      language: 'fa',
    });
    expect(outcome).toMatchObject({ outcome: 'ok', results: [], snapshotId: world.a });
  });
});
