import { ApplicationService, createApplicationComposition, loadConfig } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';
import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const servers: ReturnType<typeof buildApiServer>[] = [];
const contexts: TestPlatform[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

function emptyServer() {
  const server = buildApiServer(createApplicationComposition({}), { logger: false });
  servers.push(server);
  return server;
}

async function installedServer() {
  const context = await createTestPlatform();
  contexts.push(context);
  const snapshotId = await installSnapshot(context.platform);
  const config = loadConfig({ ATLAS_DATA_ROOT: context.dataRoot });
  const server = buildApiServer(
    {
      config,
      service: new ApplicationService({
        atlas: context.platform.atlas,
        config,
        datasets: context.platform.datasets,
        resources: context.platform.resources,
      }),
    },
    { logger: false },
  );
  servers.push(server);
  return { server, snapshotId };
}

describe('local API', () => {
  it.each([
    ['/health', 200],
    ['/ready', 200],
    ['/v1/capabilities', 200],
    ['/v1/dataset', 200],
    ['/v1/basemap', 200],
  ] as const)('serves %s with request IDs', async (path, statusCode) => {
    const response = await emptyServer().inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toHaveProperty('requestId');
  });

  it('reports a healthy, ready host that has no dataset installed', async () => {
    const server = emptyServer();
    const ready = await server.inject({ method: 'GET', url: '/ready' });
    const dataset = await server.inject({ method: 'GET', url: '/v1/dataset' });
    const capabilities = await server.inject({ method: 'GET', url: '/v1/capabilities' });
    const basemap = await server.inject({ method: 'GET', url: '/v1/basemap' });

    expect(ready.json()).toMatchObject({ ready: true });
    expect(dataset.json()).toMatchObject({ region: 'iran', state: 'not_installed' });
    expect(capabilities.json()).toMatchObject({ schemaVersion: 1 });
    expect(basemap.json()).toMatchObject({
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    });
  });

  it('reflects an installed basemap in every status surface', async () => {
    const { server, snapshotId } = await installedServer();

    const dataset = await server.inject({ method: 'GET', url: '/v1/dataset' });
    expect(dataset.json()).toMatchObject({ region: 'iran', snapshotId, state: 'ready' });

    const capabilities = await server.inject({ method: 'GET', url: '/v1/capabilities' });
    expect(capabilities.json()).toMatchObject({
      features: {
        basemap: { available: true, version: snapshotId },
        routing: { available: false, reason: 'not_installed' },
        search: { available: false, reason: 'not_installed' },
      },
    });

    const basemap = await server.inject({ method: 'GET', url: '/v1/basemap' });
    expect(basemap.json()).toMatchObject({
      availability: 'ready',
      mediaType: 'application/vnd.pmtiles',
      resourceUrl: `/maps/v1/${snapshotId}/basemap.pmtiles`,
      snapshotId,
      vectorFormat: 'mvt',
    });
  });

  it('exposes no route that mutates the dataset', async () => {
    const server = emptyServer();
    for (const [method, url] of [
      ['POST', '/v1/dataset'],
      ['PUT', '/v1/dataset'],
      ['DELETE', '/v1/dataset'],
      ['POST', '/v1/basemap'],
      ['POST', '/v1/snapshots'],
      ['POST', '/v1/snapshots/activate'],
      ['POST', '/v1/update'],
      ['POST', '/v1/rollback'],
    ] as const) {
      const response = await server.inject({ method, url });
      expect([404, 405], `${method} ${url}`).toContain(response.statusCode);
    }
  });

  it('uses structured errors without stack traces', async () => {
    const response = await emptyServer().inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
    expect(response.body).not.toContain('stack');
  });
});
