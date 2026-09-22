import { createApplicationComposition } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';

const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('local API', () => {
  it.each([
    ['/health', 200],
    ['/ready', 200],
    ['/v1/capabilities', 200],
    ['/v1/dataset', 200],
  ] as const)('serves %s with request IDs', async (path, statusCode) => {
    const server = buildApiServer(createApplicationComposition({}), { logger: false });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toHaveProperty('requestId');
  });

  it('returns the expected M0 readiness, dataset, and capability states', async () => {
    const server = buildApiServer(createApplicationComposition({}), { logger: false });
    servers.push(server);
    const ready = await server.inject({ method: 'GET', url: '/ready' });
    const dataset = await server.inject({ method: 'GET', url: '/v1/dataset' });
    const capabilities = await server.inject({ method: 'GET', url: '/v1/capabilities' });
    expect(ready.json()).toMatchObject({ ready: true });
    expect(dataset.json()).toMatchObject({ region: 'iran', state: 'not_installed' });
    expect(capabilities.json()).toMatchObject({ schemaVersion: 1 });
  });

  it('uses structured errors without stack traces', async () => {
    const server = buildApiServer(createApplicationComposition({}), { logger: false });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
    expect(response.body).not.toContain('stack');
  });
});
