import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApplicationComposition } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';
import { run } from '../../apps/cli/src/run.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import type { SnapshotManifest } from '../../packages/atlas-os/src/snapshot.js';
import { addSearchComponent } from '../helpers/search-snapshot.js';
import { StubHost, type StubBehaviour } from '../helpers/stub-host.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function environment(dataRoot: string, apiPort = 9): Record<string, string | undefined> {
  return {
    ATLAS_API_PORT: String(apiPort),
    ATLAS_DATA_ROOT: dataRoot,
    ATLAS_FONT_PATH: join(process.cwd(), 'assets', 'fonts', 'Vazirmatn-Regular.ttf'),
    ATLAS_REGION: 'iran',
    ATLAS_REGION_CONFIG_PATH: join(process.cwd(), 'config', 'regions', 'iran.yaml'),
    ATLAS_TILE_TOOL_KIND: 'synthetic',
  };
}

async function cli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): Promise<{ code: number; output: Record<string, unknown> }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run(argv, env, process.cwd());
    return { code, output: JSON.parse(chunks.join('')) as Record<string, unknown> };
  } finally {
    process.stdout.write = original;
  }
}

/** A data root with an active schema-2 snapshot in blue and a prepared one in green. */
async function world(options: { readonly greenSearch?: boolean } = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'atlas-cli-search-'));
  cleanups.push(() => rm(dataRoot, { force: true, recursive: true }));
  const env = environment(dataRoot);
  const prepare = async (source: string) =>
    (await cli(['update', 'prepare', '--source-name', source], env)).output['prepared'] as string;
  const active = await prepare('active');
  await addSearchComponent(join(dataRoot, 'slots', 'blue'));
  await cli(['update', 'activate', active, '--activate-while-search-starting'], env);
  const candidate = await prepare('candidate');
  if (options.greenSearch !== false) await addSearchComponent(join(dataRoot, 'slots', 'green'));
  return { active, candidate, dataRoot };
}

/** A local API whose hosts are stubs in the given states, listening on a real loopback port. */
async function api(dataRoot: string, blue: StubBehaviour, green: StubBehaviour) {
  const store = new SnapshotStore(dataRoot);
  const hosts = await Promise.all(
    (['blue', 'green'] as const).map(async (slot, index) => {
      const host = await StubHost.start((await store.readManifest(slot)) as SnapshotManifest, slot);
      host.behaviour = [blue, green][index]!;
      cleanups.push(() => host.close());
      return host;
    }),
  );
  const server = buildApiServer(
    createApplicationComposition({
      ATLAS_DATA_ROOT: dataRoot,
      ATLAS_SEARCH_ENGINE_BLUE_URL: hosts[0]!.url.href,
      ATLAS_SEARCH_ENGINE_GREEN_URL: hosts[1]!.url.href,
    }),
    { logger: false },
  );
  cleanups.push(() => server.close());
  await server.listen({ host: '127.0.0.1', port: 0 });
  return (server.server.address() as { port: number }).port;
}

async function pointer(dataRoot: string) {
  return JSON.parse(await readFile(join(dataRoot, 'active.json'), 'utf8')) as {
    snapshotId: string;
  };
}

describe('search-aware dataset administration', () => {
  it('activates only once the standby engine is ready for exactly that snapshot', async () => {
    const { active, candidate, dataRoot } = await world();

    const loading = await api(dataRoot, 'ready', 'loading');
    const refused = await cli(['update', 'activate', candidate], environment(dataRoot, loading));
    expect(refused.code).toBe(2);
    expect(refused.output).toMatchObject({
      code: 'SEARCH_NOT_READY',
      details: { override: '--activate-while-search-starting', search: 'starting' },
      retryable: true,
    });
    expect((await pointer(dataRoot)).snapshotId).toBe(active);

    const ready = await api(dataRoot, 'ready', 'ready');
    const accepted = await cli(['update', 'activate', candidate], environment(dataRoot, ready));
    expect(accepted).toEqual({ code: 0, output: { activated: candidate, ok: true } });
    expect((await pointer(dataRoot)).snapshotId).toBe(candidate);
  });

  it('refuses when readiness cannot be checked, unless the named override is given', async () => {
    const { active, candidate, dataRoot } = await world();
    const env = environment(dataRoot);

    const refused = await cli(['update', 'activate', candidate], env);
    expect(refused.output).toMatchObject({
      code: 'SEARCH_NOT_READY',
      details: { localApi: 'unreachable' },
    });
    expect((await pointer(dataRoot)).snapshotId).toBe(active);

    expect(
      (await cli(['update', 'activate', candidate, '--activate-while-search-starting=no'], env))
        .code,
    ).toBe(64);

    const forced = await cli(
      ['update', 'activate', candidate, '--activate-while-search-starting'],
      env,
    );
    expect(forced).toEqual({
      code: 0,
      output: { activated: candidate, ok: true, searchReadiness: 'not_checked' },
    });
    expect((await pointer(dataRoot)).snapshotId).toBe(candidate);

    // After a forced activation search says it is starting; it never serves the old generation.
    const port = await api(dataRoot, 'ready', 'loading');
    const dataset = (await (await fetch(`http://127.0.0.1:${port}/v1/dataset`)).json()) as {
      search: unknown;
    };
    expect(dataset.search).toEqual({ reason: 'starting', retryable: true, state: 'unavailable' });
    const answer = await fetch(`http://127.0.0.1:${port}/v1/search?q=ab`);
    expect(answer.status).toBe(503);
  });

  it('activates a basemap-only snapshot without consulting search at all', async () => {
    const { candidate, dataRoot } = await world({ greenSearch: false });
    const result = await cli(['update', 'activate', candidate], environment(dataRoot));
    expect(result).toEqual({ code: 0, output: { activated: candidate, ok: true } });
  });

  it('reports the serving API search state in doctor, and says when it cannot', async () => {
    const { dataRoot } = await world();
    const port = await api(dataRoot, 'loading', 'ready');
    const reachable = await cli(['doctor'], environment(dataRoot, port));
    const checks = reachable.output['checks'] as {
      name: string;
      status: string;
      message: string;
    }[];
    expect(checks.find((check) => check.name === 'search')).toEqual({
      message: 'Search is starting for the active snapshot.',
      name: 'search',
      status: 'warn',
    });

    const unreachable = await cli(['doctor'], environment(dataRoot));
    const offline = unreachable.output['checks'] as { name: string; status: string }[];
    expect(offline.find((check) => check.name === 'search')).toMatchObject({ status: 'warn' });
    expect(unreachable.output['localApi']).toBe('unreachable');
  });

  it('lists which snapshots carry search', async () => {
    const { active, candidate, dataRoot } = await world({ greenSearch: false });
    const listed = await cli(['update', 'list'], environment(dataRoot));
    const snapshots = listed.output['snapshots'] as { snapshotId: string; hasSearch: boolean }[];
    expect(snapshots.find((entry) => entry.snapshotId === active)?.hasSearch).toBe(true);
    expect(snapshots.find((entry) => entry.snapshotId === candidate)?.hasSearch).toBe(false);
  });
});
