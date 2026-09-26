import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SpaceMeasurement } from '../../packages/atlas-os/src/internal/search/host/copy.js';
import { measureSpace } from '../../packages/atlas-os/src/internal/search/host/copy.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';
import {
  addSearchComponent,
  remark,
  type ManifestRecord,
  type SearchComponentOptions,
} from '../helpers/search-snapshot.js';
import { startTestHost, waitFor, type TestHost } from '../helpers/search-host.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const contexts: TestPlatform[] = [];
const hosts: TestHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

async function platform(): Promise<TestPlatform> {
  const context = await createTestPlatform();
  contexts.push(context);
  return context;
}

/** Prepares a snapshot into the inactive slot and gives it a sealed search component. */
async function prepareSearch(
  context: TestPlatform,
  mutate?: (manifest: ManifestRecord) => void,
  options?: SearchComponentOptions,
): Promise<{ readonly snapshotId: string; readonly slot: 'blue' | 'green' }> {
  const snapshotId = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'fixture',
  });
  const slot = (await new SnapshotStore(context.dataRoot).findSlot(snapshotId))!;
  await addSearchComponent(join(context.dataRoot, 'slots', slot), mutate, options);
  return { slot, snapshotId };
}

async function host(
  context: TestPlatform,
  options: Omit<Parameters<typeof startTestHost>[0], 'dataRoot' | 'slot'> & {
    slot?: 'blue' | 'green';
  } = {},
): Promise<TestHost> {
  const started = await startTestHost({ dataRoot: context.dataRoot, slot: 'blue', ...options });
  hosts.push(started);
  return started;
}

async function get(url: URL, path: string): Promise<Response> {
  return fetch(new URL(path, url));
}

const TEHRAN = '/v1/search?q=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&lang=fa&limit=5';

/** A filesystem that cannot share extents, so every working copy needs real space. */
async function noClone(): Promise<void> {
  throw Object.assign(new Error('clone unsupported'), { code: 'ENOTSUP' });
}

/** The single working copy on a host, with its digest; the engine has already written into it. */
async function residentTree(engineHost: TestHost): Promise<{ name: string; digest: string }> {
  const trees = await readdir(join(engineHost.workRoot, 'trees'));
  expect(trees).toHaveLength(1);
  const name = trees[0]!;
  return { digest: (await listTree(join(engineHost.workRoot, 'trees', name))).digest, name };
}

describe('search engine host', () => {
  it('loads a sealed slot from a working copy and never writes to the slot', async () => {
    const context = await platform();
    const { snapshotId } = await prepareSearch(context);
    const slotEngine = join(context.dataRoot, 'slots', 'blue', 'search', 'engine');
    const before = await listTree(slotEngine);

    const engineHost = await host(context);
    const load = await engineHost.ready();
    expect(load).toMatchObject({ slot: 'blue', snapshotId });
    expect(load.loadId).toMatch(UUID);

    const status = await engineHost.status();
    expect(status.diagnostics.copyMethod).toMatch(/^(clone|copy)$/);
    expect(status.diagnostics.treeBytes).toBe(before.bytes);
    expect(status.diagnostics.heapLimit).toBe('64m');

    // The engine wrote into its working copy; the sealed slot is byte-for-byte unchanged.
    const trees = await readdir(join(engineHost.workRoot, 'trees'));
    expect(trees).toHaveLength(1);
    await expect(
      stat(
        join(
          engineHost.workRoot,
          'trees',
          trees[0]!,
          'photon_data/node_1/data/nodes/0/runtime.lock',
        ),
      ),
    ).resolves.toBeDefined();
    expect((await listTree(slotEngine)).digest).toBe(before.digest);
  });

  it('answers with its load identity and refuses anything outside its private protocol', async () => {
    const context = await platform();
    const { snapshotId } = await prepareSearch(context);
    const engineHost = await host(context);
    const load = await engineHost.ready();

    const answer = await get(
      engineHost.url,
      '/v1/search?q=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&lang=fa&limit=5',
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-atlas-load-id')).toBe(load.loadId);
    expect(answer.headers.get('x-atlas-snapshot')).toBe(snapshotId);
    expect(answer.headers.get('x-atlas-generation')).toBe(load.generationMarker);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    const body = (await answer.json()) as { features: unknown[] };
    expect(body.features.length).toBeGreaterThan(0);

    for (const path of [
      '/v1/search?q=x&lang=fa&limit=5&debug=true',
      '/v1/search?q=x&q=y&lang=fa&limit=5',
      '/v1/search?q=x&lang=de&limit=5',
      '/v1/search?q=x&lang=fa&limit=21',
      '/v1/search?q=x&lang=fa&limit=5&lat=35',
      '/v1/search?q=x&lang=fa&limit=5&bbox=1,2,3',
      '/v1/search?q=%01&lang=fa&limit=5',
      '/v1/reverse?lat=35&lang=fa&limit=3',
      '/v1/reverse?lat=35&lon=51&lang=fa&limit=6',
      '/v1/status?verbose=1',
    ]) {
      expect((await get(engineHost.url, path)).status, path).toBe(400);
    }
    expect((await get(engineHost.url, '/api?q=x')).status).toBe(404);
    expect((await get(engineHost.url, '/nominatim-update')).status).toBe(404);
    expect((await fetch(new URL('/v1/status', engineHost.url), { method: 'POST' })).status).toBe(
      405,
    );
  });

  it('gives every host start a new load identity', async () => {
    const context = await platform();
    await prepareSearch(context);
    const first = await host(context);
    const firstLoad = await first.ready();
    await first.close();
    hosts.splice(hosts.indexOf(first), 1);

    const second = await host(context);
    const secondLoad = await second.ready();
    expect(secondLoad.loadId).not.toBe(firstLoad.loadId);
    expect(secondLoad.snapshotId).toBe(firstLoad.snapshotId);
  });

  it('stays idle for an empty slot or a basemap-only snapshot', async () => {
    const context = await platform();
    const empty = await host(context);
    await waitFor(async () => ((await empty.status()).state === 'idle' ? true : undefined));

    await context.platform.datasets.prepareUpdate({ inputs: [], sourceName: 'fixture' });
    await waitFor(async () => {
      const status = await empty.status();
      return status.state === 'idle' && status.pending === null ? true : undefined;
    });
    const refused = await get(empty.url, '/v1/search?q=x&lang=fa&limit=5');
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { state: string }).state).toBe('idle');
  });

  it('refuses a working copy that does not match the seal, then recovers from the slot', async () => {
    const context = await platform();
    await prepareSearch(context);
    let tampered = false;
    const engineHost = await host(context, {
      afterCopy: async (path) => {
        if (tampered) return;
        tampered = true;
        await appendFile(join(path, 'photon_data/node_1/config/opensearch.yml'), 'x');
      },
    });
    const failed = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'failed' ? status : undefined;
    });
    expect(failed.load).toBeNull();
    expect(failed.pending?.state).toBe('failed');
    // The interrupted copy leaves nothing behind.
    expect(await readdir(join(engineHost.workRoot, 'incoming'))).toEqual([]);
    await engineHost.ready();
  });

  const refusals: readonly {
    readonly label: string;
    readonly mutate: (manifest: ManifestRecord) => void;
    readonly options: SearchComponentOptions;
  }[] = [
    {
      label: 'a canary that carries another generation',
      mutate: (manifest) => {
        manifest.search.dump['sha256'] = `sha256:${'9'.repeat(64)}`;
        remark(manifest);
      },
      options: {},
    },
    {
      label: 'an engine reporting another import instant',
      mutate: (manifest) => {
        manifest.search.engine['importDate'] = '2026-01-01T00:00:05.001Z';
        remark(manifest);
      },
      options: { importDate: '2026-01-01T00:00:05.000Z' },
    },
    {
      label: 'a probe the data does not answer',
      mutate: () => undefined,
      options: {
        probes: [
          { expectId: 'osm:node:8000000000000077', language: 'fa', query: 'تهران', type: 'search' },
        ],
      },
    },
  ];

  it.each(refusals)('never opens for $label', async ({ mutate, options }) => {
    const context = await platform();
    await prepareSearch(context, mutate, options);
    const engineHost = await host(context);
    const failed = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'failed' ? status : undefined;
    });
    expect(failed.load).toBeNull();
    // The host stopped this engine itself; that is not an engine exit to explain.
    expect(failed.diagnostics.lastEngineExit).toBeNull();
    const refused = await get(engineHost.url, '/v1/search?q=x&lang=fa&limit=5');
    expect(refused.status).toBe(503);
  });

  it('accepts the engine printing a zero-millisecond instant without its fraction', async () => {
    const context = await platform();
    await prepareSearch(context, undefined, { importDate: '2026-01-01T00:00:05.000Z' });
    const engineHost = await host(context);
    expect((await engineHost.ready()).engineImportDate).toBe('2026-01-01T00:00:05.000Z');
  });

  it('reports insufficient space instead of starting when a full copy would not fit', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context, {
      cloneFile: noClone,
      config: { reserveBytes: Number.MAX_SAFE_INTEGER },
    });
    const status = await waitFor(async () => {
      const current = await engineHost.status();
      return current.state === 'insufficient_space' ? current : undefined;
    });
    expect(status.pending).toMatchObject({ state: 'insufficient_space' });
    expect(status.load).toBeNull();
    expect(await readdir(join(engineHost.workRoot, 'trees'))).toEqual([]);
  });

  it('closes the gate at once when the engine dies, then reloads under a new identity', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context, { config: { retryMs: 60_000 } });
    const first = await engineHost.ready();
    await engineHost.control('exit');
    const reloaded = await engineHost.ready(first.loadId);
    expect(reloaded.snapshotId).toBe(first.snapshotId);
    expect(reloaded.loadId).not.toBe(first.loadId);
  });

  it('reloads a replaced slot and fails an answer that was in flight across the transition', async () => {
    const context = await platform();
    const { snapshotId: first } = await prepareSearch(context);
    const engineHost = await host(context);
    const firstLoad = await engineHost.ready();

    await engineHost.control('hold');
    const inFlight = get(
      engineHost.url,
      '/v1/search?q=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&lang=fa&limit=5',
    );
    await waitFor(async () => ((await engineHost.control('state')).held > 0 ? true : undefined));

    // Nothing is active, so the next preparation replaces this same slot.
    const { snapshotId: second } = await prepareSearch(context);
    expect(second).not.toBe(first);

    const stale = await inFlight;
    expect(stale.status).toBe(503);
    expect(stale.headers.get('x-atlas-load-id')).toBeNull();

    const secondLoad = await engineHost.ready(firstLoad.loadId);
    expect(secondLoad.snapshotId).toBe(second);
  });

  it('keeps the ready working copy when its replacement would not fit, then switches', async () => {
    const context = await platform();
    const { snapshotId: first } = await prepareSearch(context);
    let space: SpaceMeasurement | undefined;
    const engineHost = await host(context, {
      cloneFile: noClone,
      measureSpace: async (path) => space ?? measureSpace(path),
    });
    const firstLoad = await engineHost.ready();
    const before = await residentTree(engineHost);
    const firstEngine = (await engineHost.control('state')).pid;

    space = { availableBytes: 0, blockSize: 4096 };
    const { snapshotId: second } = await engineHost.changeSlot(() => prepareSearch(context));
    const refused = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'insufficient_space' ? status : undefined;
    });
    // The new generation is reported unavailable, and the old one is never served again.
    expect(refused.load).toBeNull();
    expect(refused.pending).toEqual({ snapshotId: second, state: 'insufficient_space' });
    const closed = await get(engineHost.url, TEHRAN);
    expect(closed.status).toBe(503);
    expect(closed.headers.get('x-atlas-load-id')).toBeNull();
    // The previously ready copy and its engine are intact behind the closed gate.
    expect(await residentTree(engineHost)).toEqual(before);
    expect((await engineHost.control('state')).pid).toBe(firstEngine);
    expect(await readdir(join(engineHost.workRoot, 'incoming'))).toEqual([]);

    space = undefined;
    const secondLoad = await engineHost.ready(firstLoad.loadId);
    expect(secondLoad.snapshotId).toBe(second);
    expect(secondLoad.snapshotId).not.toBe(first);
    expect(secondLoad.loadId).not.toBe(firstLoad.loadId);
    // Switched at the safe point: the old engine is gone and its copy removed.
    expect((await residentTree(engineHost)).name).not.toBe(before.name);
    expect((await engineHost.control('state')).pid).not.toBe(firstEngine);
    const answer = await get(engineHost.url, TEHRAN);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-atlas-load-id')).toBe(secondLoad.loadId);
  });

  it('keeps the ready working copy when its replacement does not match the seal', async () => {
    const context = await platform();
    await prepareSearch(context);
    let tamperNext = false;
    const engineHost = await host(context, {
      afterCopy: async (path) => {
        if (!tamperNext) return;
        tamperNext = false;
        await appendFile(join(path, 'photon_data/node_1/config/opensearch.yml'), 'x');
      },
      config: { retryMs: 60_000 },
    });
    const firstLoad = await engineHost.ready();
    const before = await residentTree(engineHost);
    const firstEngine = (await engineHost.control('state')).pid;

    tamperNext = true;
    const { snapshotId: second } = await engineHost.changeSlot(() => prepareSearch(context));
    const failed = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'failed' ? status : undefined;
    });
    expect(failed.load).toBeNull();
    expect(failed.pending).toEqual({ snapshotId: second, state: 'failed' });
    expect((await get(engineHost.url, TEHRAN)).status).toBe(503);
    expect(await residentTree(engineHost)).toEqual(before);
    expect((await engineHost.control('state')).pid).toBe(firstEngine);
    expect(await readdir(join(engineHost.workRoot, 'incoming'))).toEqual([]);

    // The next transition builds an untampered copy and switches at the safe point.
    const { snapshotId: third } = await engineHost.changeSlot(() => prepareSearch(context));
    const thirdLoad = await engineHost.ready(firstLoad.loadId);
    expect(thirdLoad.snapshotId).toBe(third);
    expect((await residentTree(engineHost)).name).not.toBe(before.name);
    expect((await engineHost.control('state')).pid).not.toBe(firstEngine);
  });

  it('retries a failed replacement on its own and serves it under a new identity', async () => {
    const context = await platform();
    await prepareSearch(context);
    let tamperNext = false;
    const engineHost = await host(context, {
      afterCopy: async (path) => {
        if (!tamperNext) return;
        tamperNext = false;
        await appendFile(join(path, 'photon_data/node_1/config/opensearch.yml'), 'x');
      },
    });
    const firstLoad = await engineHost.ready();
    tamperNext = true;
    const { snapshotId: second } = await engineHost.changeSlot(() => prepareSearch(context));
    await waitFor(async () => ((await engineHost.status()).state === 'failed' ? true : undefined));
    const secondLoad = await engineHost.ready(firstLoad.loadId);
    expect(secondLoad.snapshotId).toBe(second);
    expect(secondLoad.loadId).not.toBe(firstLoad.loadId);
    expect(await readdir(join(engineHost.workRoot, 'trees'))).toHaveLength(1);
  });

  it('reopens the resident load under a new identity when the slot shows it again', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context);
    const firstLoad = await engineHost.ready();
    const before = await residentTree(engineHost);
    const firstEngine = (await engineHost.control('state')).pid;

    const manifest = join(context.dataRoot, 'slots', 'blue', 'manifest.json');
    const original = await readFile(manifest);
    await writeFile(manifest, '{');
    const failed = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'failed' ? status : undefined;
    });
    expect(failed.load).toBeNull();
    expect((await get(engineHost.url, TEHRAN)).status).toBe(503);

    await writeFile(manifest, original);
    const resumed = await engineHost.ready(firstLoad.loadId);
    expect(resumed.snapshotId).toBe(firstLoad.snapshotId);
    expect(resumed.loadId).not.toBe(firstLoad.loadId);
    // Nothing was copied again: the same engine serves the same working copy.
    expect((await engineHost.control('state')).pid).toBe(firstEngine);
    expect((await residentTree(engineHost)).name).toBe(before.name);
    const answer = await get(engineHost.url, TEHRAN);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-atlas-load-id')).toBe(resumed.loadId);
  });

  it('keeps the resident load through a moment without search, as during a promotion', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context, { config: { retryMs: 60_000 } });
    const first = await engineHost.ready();
    const before = await residentTree(engineHost);
    const firstEngine = (await engineHost.control('state')).pid;

    // Promotion removes the slot and renames its replacement into place.
    const manifest = join(context.dataRoot, 'slots', 'blue', 'manifest.json');
    const original = await readFile(manifest);
    await rm(manifest);
    const idle = await waitFor(async () => {
      const status = await engineHost.status();
      return status.state === 'idle' ? status : undefined;
    });
    expect(idle.load).toBeNull();
    expect((await get(engineHost.url, TEHRAN)).status).toBe(503);
    expect(await residentTree(engineHost)).toEqual(before);

    await writeFile(manifest, original);
    const resumed = await engineHost.ready(first.loadId);
    expect(resumed.snapshotId).toBe(first.snapshotId);
    expect((await engineHost.control('state')).pid).toBe(firstEngine);
  });

  it('removes the resident load once its slot stays without search', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context, { config: { retryMs: 300 } });
    const first = await engineHost.ready();

    const manifest = join(context.dataRoot, 'slots', 'blue', 'manifest.json');
    const original = await readFile(manifest);
    await rm(manifest);
    await waitFor(async () =>
      (await readdir(join(engineHost.workRoot, 'trees'))).length === 0 ? true : undefined,
    );
    const status = await engineHost.status();
    expect(status).toMatchObject({ load: null, pending: null, state: 'idle' });
    await expect(engineHost.control('state')).rejects.toThrow();

    // Search appearing again is a new load from the sealed slot, under a new identity.
    await writeFile(manifest, original);
    const reloaded = await engineHost.ready(first.loadId);
    expect(reloaded.snapshotId).toBe(first.snapshotId);
  });

  const exits: readonly {
    readonly label: string;
    readonly reason: 'memory_limit' | 'pids_limit' | 'heap_exhausted';
    readonly counter?: readonly [string, string];
    readonly action: 'exit' | 'kill';
    readonly code?: string;
  }[] = [
    {
      action: 'kill',
      counter: ['memory.events', 'oom_kill 1\n'],
      label: 'killed at its memory limit',
      reason: 'memory_limit',
    },
    {
      action: 'exit',
      code: '3',
      counter: ['pids.events', 'max 1\n'],
      label: 'refused a thread at its PID limit',
      reason: 'pids_limit',
    },
    { action: 'exit', code: '3', label: 'out of heap', reason: 'heap_exhausted' },
  ];

  it.each(exits)(
    'reports an engine $label, fails closed and reloads',
    async ({ action, code, counter, reason }) => {
      const context = await platform();
      await prepareSearch(context);
      const cgroupRoot = join(context.dataRoot, '..', `${basename(context.dataRoot)}-cgroup`);
      await mkdir(cgroupRoot, { recursive: true });
      await writeFile(join(cgroupRoot, 'memory.max'), '1073741824\n');
      await writeFile(join(cgroupRoot, 'pids.max'), '512\n');
      await writeFile(join(cgroupRoot, 'memory.events'), 'oom_kill 0\n');
      await writeFile(join(cgroupRoot, 'pids.events'), 'max 0\n');
      try {
        const engineHost = await host(context, { cgroupRoot, config: { retryMs: 60_000 } });
        const first = await engineHost.ready();
        const before = await engineHost.status();
        expect(before.diagnostics).toMatchObject({
          lastEngineExit: null,
          memoryLimitBytes: 1_073_741_824,
          pidsLimit: 512,
        });

        if (counter !== undefined) await writeFile(join(cgroupRoot, counter[0]), counter[1]);
        await engineHost.control(action, code === undefined ? {} : { code }).catch(() => undefined);
        const reloaded = await engineHost.ready(first.loadId);
        expect(reloaded.snapshotId).toBe(first.snapshotId);
        expect((await engineHost.status()).diagnostics.lastEngineExit).toBe(reason);
      } finally {
        await rm(cgroupRoot, { force: true, recursive: true });
      }
    },
  );

  it('holds its final check even with a fence configured', async () => {
    const context = await platform();
    await prepareSearch(context);
    const engineHost = await host(context, { config: { fenceMs: 25 } });
    const load = await engineHost.ready();
    const answer = await get(engineHost.url, '/v1/reverse?lat=35.7002&lon=51.3605&lang=fa&limit=3');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-atlas-load-id')).toBe(load.loadId);
  });

  it('removes stale working copies when it starts', async () => {
    const context = await platform();
    await prepareSearch(context);
    const workRoot = join(context.dataRoot, '..', `${basename(context.dataRoot)}-work`);
    await mkdir(workRoot);
    try {
      const first = await startTestHost({ dataRoot: context.dataRoot, slot: 'blue', workRoot });
      await first.ready();
      await writeFile(join(workRoot, 'incoming', 'leftover'), 'x');
      await first.close();

      const second = await host(context, { workRoot });
      await second.ready();
      expect(await readdir(join(workRoot, 'incoming'))).toEqual([]);
      expect(await readdir(join(workRoot, 'trees'))).toHaveLength(1);
      await second.close();
      hosts.splice(hosts.indexOf(second), 1);
    } finally {
      await rm(workRoot, { force: true, recursive: true });
    }
  });
});
