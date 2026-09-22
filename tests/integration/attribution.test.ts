import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ApplicationService, loadConfig } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';
import { buildStyleDocument } from '../../packages/atlas-os/src/internal/basemap/style.js';
import { TOOL_ATTRIBUTION } from '../../packages/atlas-os/src/internal/tools/planetiler.js';
import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];
const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

/**
 * A production snapshot carries the attribution the tile schema requires. The test fixture is
 * generated geometry that contains no OpenStreetMap data, so crediting those projects for it
 * would itself be a licensing error; the production attribution is therefore exercised by
 * installing it into a snapshot's style and manifest directly.
 */
async function installWithProductionAttribution(context: TestPlatform): Promise<string> {
  const snapshotId = await installSnapshot(context.platform);
  const slot = join(context.dataRoot, 'slots', 'blue');

  const stylePath = join(slot, 'basemap', 'style.json');
  const existing = JSON.parse(await readFile(stylePath, 'utf8')) as Record<string, unknown>;
  const style = buildStyleDocument({
    attribution: TOOL_ATTRIBUTION,
    bounds: { east: 63.333, north: 39.782, south: 24.397, west: 44.033 },
    center: { latitude: 35.6892, longitude: 51.389, zoom: 5 },
    labelLanguages: ['fa', 'en'],
    maxZoom: 13,
    minZoom: 0,
    name: String(existing['name'] ?? 'basemap'),
    snapshotId,
  });
  await writeFile(stylePath, `${JSON.stringify(style, null, 2)}\n`);
  return snapshotId;
}

function serverFor(context: TestPlatform) {
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
  return server;
}

describe('basemap attribution', () => {
  it('serves a production style crediting both required projects with links', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const snapshotId = await installWithProductionAttribution(context);
    const server = serverFor(context);

    const response = await server.inject({
      method: 'GET',
      url: `/maps/v1/${snapshotId}/style.json`,
    });
    expect(response.statusCode).toBe(200);

    const style = response.json() as { sources: Record<string, { attribution?: string }> };
    const attribution = style.sources['basemap']?.attribution ?? '';

    expect(attribution).toContain('OpenMapTiles');
    expect(attribution).toContain('OpenStreetMap contributors');
    expect(attribution).toContain('href="https://www.openmaptiles.org/"');
    expect(attribution).toContain('href="https://www.openstreetmap.org/copyright"');
    // Rendered as links a viewer may follow, never fetched while rendering.
    expect(attribution).toContain('target="_blank"');
  });

  it('reports the active snapshot attribution in the basemap descriptor', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    await installSnapshot(context.platform);
    const server = serverFor(context);

    const response = await server.inject({ method: 'GET', url: '/v1/basemap' });
    const descriptor = response.json() as { attribution: string; availability: string };

    expect(descriptor.availability).toBe('ready');
    expect(descriptor.attribution.length).toBeGreaterThan(0);
    // The fixture must say plainly that it is not a map of a real place.
    expect(descriptor.attribution).toContain('not a map of any territory');
  });
});
