import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ApplicationService, loadConfig } from '@atlas-os/core';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';
import { createTestPlatform, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];
const servers: ReturnType<typeof buildApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

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

async function installTwo(context: TestPlatform) {
  const first = await context.platform.datasets.prepareUpdate({ inputs: [], sourceName: 'first' });
  await context.platform.datasets.activateSnapshot(first);
  const second = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'second',
  });
  await context.platform.datasets.activateSnapshot(second);
  return { first, second };
}

describe('versioned resource identity', () => {
  it('keeps the previous snapshot addressable after an activation', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const { first, second } = await installTwo(context);
    const server = serverFor(context);

    // Already-loaded browser sessions hold URLs for the snapshot that was active when they
    // started; those must keep working across an activation.
    for (const id of [first, second]) {
      const response = await server.inject({ method: 'GET', url: `/maps/v1/${id}/style.json` });
      expect(response.statusCode, `snapshot ${id}`).toBe(200);
    }
  });

  it('refuses a snapshot that is neither active nor the retained previous one', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const { first, second } = await installTwo(context);
    // A third activation pushes the first snapshot out of the addressable set.
    const third = await context.platform.datasets.prepareUpdate({
      inputs: [],
      sourceName: 'third',
    });
    await context.platform.datasets.activateSnapshot(third);
    const server = serverFor(context);

    expect(
      (await server.inject({ method: 'GET', url: `/maps/v1/${third}/style.json` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: 'GET', url: `/maps/v1/${second}/style.json` })).statusCode,
    ).toBe(200);
    // `first` occupied the slot that `third` has now replaced.
    expect(
      (await server.inject({ method: 'GET', url: `/maps/v1/${first}/style.json` })).statusCode,
    ).toBe(404);
  });

  it('never serves bytes from a different snapshot under an immutable URL', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const { first, second } = await installTwo(context);
    const server = serverFor(context);

    const before = await server.inject({ method: 'GET', url: `/maps/v1/${first}/style.json` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      metadata: { 'atlas-os:snapshot': first },
    });

    // Simulate the hazard the slot layout creates: the slot holding `first` is replaced by a
    // different snapshot's content, exactly as a later preparation would do by rename, while the
    // active pointer still lists `first` as the retained previous snapshot.
    const blue = join(context.dataRoot, 'slots', 'blue');
    const green = join(context.dataRoot, 'slots', 'green');
    await rm(blue, { force: true, recursive: true });
    await cp(green, blue, { recursive: true });

    const after = await server.inject({ method: 'GET', url: `/maps/v1/${first}/style.json` });

    // The URL promises immutability, so it must fail closed rather than return `second`'s bytes.
    expect(after.statusCode).toBe(404);
    expect(after.body).not.toContain(second);
  });

  it('fails closed when a slot manifest stops naming the requested snapshot', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const { first } = await installTwo(context);
    const server = serverFor(context);

    const manifestPath = join(context.dataRoot, 'slots', 'blue', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest['snapshotId'] = 'iran-20990101t000000000z-deadbeef';
    await writeFile(manifestPath, JSON.stringify(manifest));

    const response = await server.inject({
      method: 'GET',
      url: `/maps/v1/${first}/basemap.pmtiles`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('serves a ranged read from the snapshot the URL names', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    const { first, second } = await installTwo(context);
    const server = serverFor(context);

    for (const id of [first, second]) {
      const response = await server.inject({
        headers: { range: 'bytes=0-6' },
        method: 'GET',
        url: `/maps/v1/${id}/basemap.pmtiles`,
      });
      expect(response.statusCode).toBe(206);
      expect(Buffer.from(response.rawPayload).toString('ascii')).toBe('PMTiles');
    }
  });
});
