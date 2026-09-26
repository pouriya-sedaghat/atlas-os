import { join } from 'node:path';

import { createApplicationComposition } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer, rawQueryParameters } from '../../apps/api/src/server.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import type { SnapshotManifest } from '../../packages/atlas-os/src/snapshot.js';
import { addSearchComponent } from '../helpers/search-snapshot.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';
import { StubHost } from '../helpers/stub-host.js';

const PROVIDER =
  /photon|nominatim|opensearch|komoot|java\.|osm_type|osm_key|place_id|x-atlas|atlas_|loadId|generationMarker/i;

const contexts: TestPlatform[] = [];
const hosts: StubHost[] = [];
const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

/** An API over an active schema-2 snapshot whose blue host is a programmable stub. */
async function searchApi(options: { readonly engineUrl?: string; readonly v1?: boolean } = {}) {
  const context = await createTestPlatform();
  contexts.push(context);
  const snapshotId = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'fixture',
  });
  if (options.v1 !== true) await addSearchComponent(join(context.dataRoot, 'slots', 'blue'));
  await context.platform.datasets.activateSnapshot(snapshotId);
  const manifest = (await new SnapshotStore(context.dataRoot).readManifest('blue'))!;
  const host = await StubHost.start(manifest as SnapshotManifest);
  hosts.push(host);
  const server = buildApiServer(
    createApplicationComposition({
      ATLAS_DATA_ROOT: context.dataRoot,
      ATLAS_SEARCH_ENGINE_BLUE_URL: options.engineUrl ?? host.url.href,
    }),
    { logger: false },
  );
  servers.push(server);
  return { host, server, snapshotId };
}

function query(server: ReturnType<typeof buildApiServer>, url: string) {
  return server.inject({ method: 'GET', url });
}

describe('place search API', () => {
  it('answers with results, the snapshot, attribution and no caching', async () => {
    const { server, snapshotId } = await searchApi();
    const response = await query(server, '/v1/search?q=%D8%AA%D9%87%D8%B1%D8%A7%D9%86');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body).toMatchObject({
      attribution: {
        licence: 'none',
        text: 'Synthetic development fixture — not map data',
        url: null,
      },
      results: [
        {
          address: { countryCode: 'ir' },
          category: 'place:city',
          coordinate: { latitude: 35.6892, longitude: 51.389 },
          id: 'osm:node:8000000000000001',
          kind: 'city',
          name: 'تهران',
        },
      ],
      snapshotId,
    });
    expect(Object.keys(body).sort()).toEqual(['attribution', 'requestId', 'results', 'snapshotId']);
    expect(response.body).not.toMatch(PROVIDER);
  });

  it('reverse geocodes through the same envelope, and answers outside the bounds alone', async () => {
    const { host, server } = await searchApi();
    const inside = await query(server, '/v1/reverse?lat=35.7&lon=51.39&language=en');
    expect(inside.statusCode).toBe(200);
    expect(inside.json().results).toHaveLength(1);

    const before = host.queries;
    const outside = await query(server, '/v1/reverse?lat=10&lon=10');
    expect(outside.statusCode).toBe(200);
    expect(outside.json().results).toEqual([]);
    expect(host.queries).toBe(before);
  });

  it.each([
    ['/v1/search', 'q', 'missing'],
    ['/v1/search?q=%D8%AA', 'q', 'too_short'],
    [`/v1/search?q=${'a'.repeat(101)}`, 'q', 'too_long'],
    [`/v1/search?q=${'%D8%AA'.repeat(201)}`, 'q', 'too_long'],
    ['/v1/search?q=ab%01', 'q', 'control_character'],
    ['/v1/search?q=ab%C2%85', 'q', 'control_character'],
    ['/v1/search?q=ab&q=cd', 'q', 'duplicated'],
    ['/v1/search?q=ab&debug=1', 'parameters', 'unknown'],
    ['/v1/search?q=ab&limit=0', 'limit', 'out_of_range'],
    ['/v1/search?q=ab&limit=21', 'limit', 'out_of_range'],
    ['/v1/search?q=ab&limit=2.5', 'limit', 'not_an_integer'],
    ['/v1/search?q=ab&language=de', 'language', 'unsupported'],
    ['/v1/search?q=ab&lat=35', 'lon', 'incomplete_coordinate'],
    ['/v1/search?q=ab&lat=91&lon=51', 'lat', 'out_of_range'],
    ['/v1/search?q=ab&lat=NaN&lon=51', 'lat', 'not_a_number'],
    ['/v1/reverse?lon=51', 'lat', 'missing'],
    ['/v1/reverse?lat=35&lon=181', 'lon', 'out_of_range'],
    ['/v1/reverse?lat=35&lon=51&q=x', 'parameters', 'unknown'],
  ])('refuses %s as %s/%s', async (url, field, reason) => {
    const { host, server } = await searchApi();
    const before = host.queries;
    const response = await query(server, url);
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().error).toMatchObject({
      code: 'BAD_REQUEST',
      details: { field, reason },
    });
    expect(host.queries).toBe(before);
  });

  it.each([
    ['loading', 'starting', '5'],
    ['insufficient_space', 'insufficient_space', '60'],
    ['wrong_generation', 'generation_mismatch', '2'],
    ['hang', 'timeout', '2'],
  ] as const)(
    'reports a host that is %s as a retryable %s',
    async (behaviour, reason, retryAfter) => {
      const { host, server } = await searchApi();
      host.behaviour = behaviour;
      const response = await query(server, '/v1/search?q=ab');
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe(retryAfter);
      expect(response.json().error).toMatchObject({
        code: 'FEATURE_UNAVAILABLE',
        details: { reason, retryable: true },
      });
      expect(response.body).not.toMatch(PROVIDER);
    },
  );

  it('reports an unreachable host as starting', async () => {
    const { server } = await searchApi({ engineUrl: 'http://127.0.0.1:9/' });
    const response = await query(server, '/v1/search?q=ab');
    expect(response.statusCode).toBe(503);
    expect(response.json().error.details).toEqual({ reason: 'starting', retryable: true });
  });

  it.each(['malformed', 'oversized'] as const)(
    'turns a %s engine answer into a fixed neutral failure',
    async (behaviour) => {
      const { host, server } = await searchApi();
      host.behaviour = behaviour;
      const response = await query(server, '/v1/search?q=ab');
      expect(response.statusCode).toBe(502);
      expect(response.json().error).toMatchObject({
        code: 'UPSTREAM_FAILED',
        message: 'The search service returned an unusable answer.',
      });
      expect(response.body).not.toMatch(PROVIDER);
    },
  );

  it('refuses work beyond its concurrency limit as saturated', async () => {
    const { host, server } = await searchApi();
    host.behaviour = 'hold';
    const pending = Array.from({ length: 40 }, () => query(server, '/v1/search?q=ab'));
    await expect
      .poll(() => host.held, { interval: 10, timeout: 10_000 })
      .toBeGreaterThanOrEqual(32);
    host.release();
    const responses = await Promise.all(pending);
    const saturated = responses.filter((response) => response.statusCode === 503);
    expect(saturated.length).toBeGreaterThan(0);
    for (const response of saturated) {
      expect(response.json().error.details).toEqual({ reason: 'saturated', retryable: true });
      expect(response.headers['retry-after']).toBe('1');
    }
    expect(responses.filter((response) => response.statusCode === 200).length).toBe(
      40 - saturated.length,
    );
  });

  it('reports a basemap-only snapshot as missing the component, and serves its basemap', async () => {
    const { server } = await searchApi({ v1: true });
    const response = await query(server, '/v1/search?q=ab');
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.json().error.details).toEqual({
      reason: 'component_missing',
      retryable: false,
    });
    expect((await query(server, '/v1/basemap')).json()).toMatchObject({ availability: 'ready' });
  });

  it('has no mutation route', async () => {
    const { server } = await searchApi();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      for (const url of ['/v1/search?q=ab', '/v1/reverse?lat=35&lon=51', '/v1/dataset']) {
        const response = await server.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
  });

  it('reads parameters exactly as sent, duplicates included', () => {
    expect(rawQueryParameters('/v1/search?q=a&q=b&limit=5')).toEqual({
      limit: ['5'],
      q: ['a', 'b'],
    });
    expect(rawQueryParameters('/v1/search')).toEqual({});
  });
});
