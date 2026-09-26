import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApplicationComposition, type ApplicationService } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import type { SnapshotManifest } from '../../packages/atlas-os/src/snapshot.js';
import { addSearchComponent } from '../helpers/search-snapshot.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';
import { StubHost, type StubBehaviour } from '../helpers/stub-host.js';

/**
 * Search availability is one resolution. Capabilities, dataset status, readiness, doctor and the
 * search and reverse routes must all say the same thing about it, in every state, and a search
 * problem must never degrade the basemap.
 */

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Setup = 'absent' | 'v1' | 'corrupt' | StubBehaviour;

async function service(setup: Setup): Promise<{
  readonly service: ApplicationService;
  readonly snapshotId: string | null;
}> {
  if (setup === 'absent') {
    const dataRoot = await mkdtemp(join(tmpdir(), 'atlas-os-consistency-'));
    cleanups.push(() => rm(dataRoot, { force: true, recursive: true }));
    return {
      service: createApplicationComposition({ ATLAS_DATA_ROOT: dataRoot }).service,
      snapshotId: null,
    };
  }
  const context: TestPlatform = await createTestPlatform();
  cleanups.push(() => context.cleanup());
  const snapshotId = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'fixture',
  });
  if (setup !== 'v1') await addSearchComponent(join(context.dataRoot, 'slots', 'blue'));
  await context.platform.datasets.activateSnapshot(snapshotId);
  const store = new SnapshotStore(context.dataRoot);
  const manifest = (await store.readManifest('blue'))!;
  const environment: Record<string, string> = { ATLAS_DATA_ROOT: context.dataRoot };
  if (setup !== 'v1' && setup !== 'corrupt') {
    const host = await StubHost.start(manifest as SnapshotManifest);
    host.behaviour = setup;
    cleanups.push(() => host.close());
    environment['ATLAS_SEARCH_ENGINE_BLUE_URL'] = host.url.href;
  }
  if (setup === 'corrupt') await writeFile(store.manifestPath('blue'), '{ not json');
  return { service: createApplicationComposition(environment).service, snapshotId };
}

interface Expected {
  readonly capability: Record<string, unknown>;
  readonly status: Record<string, unknown>;
  readonly readiness: 'pass' | 'warn';
  readonly search: Record<string, unknown>;
  readonly basemap: 'ready' | 'not_installed' | 'unavailable';
}

const unavailable = (reason: string, retryable: boolean) => ({
  reason,
  retryable,
  state: 'unavailable',
});

const CASES: readonly (readonly [Setup, (id: string | null) => Expected])[] = [
  [
    'absent',
    () => ({
      basemap: 'not_installed',
      capability: { available: false, reason: 'not_installed' },
      readiness: 'pass',
      search: { outcome: 'unavailable', reason: 'not_installed', retryable: false },
      status: unavailable('not_installed', false),
    }),
  ],
  [
    'v1',
    () => ({
      basemap: 'ready',
      capability: { available: false, reason: 'not_installed' },
      readiness: 'pass',
      search: { outcome: 'unavailable', reason: 'component_missing', retryable: false },
      status: unavailable('component_missing', false),
    }),
  ],
  [
    'loading',
    () => ({
      basemap: 'ready',
      capability: { available: false, reason: 'starting' },
      readiness: 'warn',
      search: { outcome: 'unavailable', reason: 'starting', retryable: true },
      status: unavailable('starting', true),
    }),
  ],
  [
    'ready',
    (id) => ({
      basemap: 'ready',
      capability: { available: true, version: id },
      readiness: 'pass',
      search: { outcome: 'ok', snapshotId: id },
      status: { snapshotId: id, state: 'ready' },
    }),
  ],
  [
    'wrong_generation',
    () => ({
      basemap: 'ready',
      capability: { available: false, reason: 'dataset_unavailable' },
      readiness: 'warn',
      search: { outcome: 'unavailable', reason: 'generation_mismatch', retryable: true },
      status: unavailable('generation_mismatch', true),
    }),
  ],
  [
    'insufficient_space',
    () => ({
      basemap: 'ready',
      capability: { available: false, reason: 'dataset_unavailable' },
      readiness: 'warn',
      search: { outcome: 'unavailable', reason: 'insufficient_space', retryable: true },
      status: unavailable('insufficient_space', true),
    }),
  ],
  [
    'corrupt',
    () => ({
      basemap: 'unavailable',
      capability: { available: false, reason: 'dataset_unavailable' },
      readiness: 'warn',
      search: { outcome: 'unavailable', reason: 'dataset_unavailable', retryable: true },
      status: unavailable('dataset_unavailable', true),
    }),
  ],
];

describe('one search availability resolution', () => {
  it.each(CASES)('agrees on every surface when search is %s', async (setup, expectation) => {
    const { service: app, snapshotId } = await service(setup);
    const expected = expectation(snapshotId);

    const capabilities = await app.capabilities();
    expect(capabilities.features.search).toEqual(expected.capability);
    expect(capabilities.features.reverse_geocoding).toEqual(expected.capability);

    const dataset = await app.datasetStatus();
    expect(dataset.search).toEqual(expected.status);

    const readiness = await app.readiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.find((check) => check.name === 'search')?.status).toBe(
      expected.readiness,
    );
    const doctor = await app.doctor();
    expect(doctor.checks.find((check) => check.name === 'search')).toEqual(
      readiness.checks.find((check) => check.name === 'search'),
    );

    expect(await app.searchPlaces({ q: ['تهران'] })).toMatchObject(expected.search);
    expect(await app.reverseGeocode({ lat: ['35.7'], lon: ['51.39'] })).toMatchObject(
      expected.search,
    );

    // Search never degrades the basemap.
    expect((await app.basemap()).availability).toBe(expected.basemap);
  });

  it.each([
    ['hang', { outcome: 'unavailable', reason: 'timeout', retryable: true }],
    ['malformed', { outcome: 'upstream_failed' }],
  ] as const)(
    'keeps a %s answer local to that query while the component stays ready',
    async (behaviour, outcome) => {
      const { service: app, snapshotId } = await service(behaviour);
      // The host is loaded with the right generation, so every surface says ready...
      expect((await app.capabilities()).features.search).toEqual({
        available: true,
        version: snapshotId,
      });
      expect((await app.datasetStatus()).search).toEqual({ snapshotId, state: 'ready' });
      // ...and the one query that failed says exactly why, with nothing from the engine in it.
      const answer = await app.searchPlaces({ q: ['تهران'] });
      expect(answer).toEqual(
        outcome.outcome === 'upstream_failed' ? outcome : { ...outcome, retryAfterSeconds: 2 },
      );
    },
  );
});
