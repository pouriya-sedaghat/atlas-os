import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createPlatform } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];

async function platformContext(
  options?: Parameters<typeof createTestPlatform>[0],
): Promise<TestPlatform> {
  const context = await createTestPlatform(options);
  contexts.push(context);
  return context;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

/**
 * Every availability surface is derived from one resolution of the stored dataset, so they can
 * never disagree. These tests assert that agreement directly, for each way a dataset can be
 * unusable.
 */
async function surfaces(context: TestPlatform) {
  const [basemap, capabilities, dataset] = await Promise.all([
    context.platform.atlas.basemap(),
    context.platform.atlas.capabilities(),
    context.platform.atlas.datasetStatus(),
  ]);
  return { basemap, capabilities, dataset };
}

describe('basemap availability', () => {
  it('reports nothing installed when no snapshot has been activated', async () => {
    const context = await platformContext();
    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toEqual({ availability: 'not_installed', reason: 'dataset_not_installed' });
    expect(capabilities.features.basemap).toEqual({ available: false, reason: 'not_installed' });
    expect(dataset).toMatchObject({ state: 'not_installed' });
  });

  it('reports a ready basemap when a snapshot is active', async () => {
    const context = await platformContext();
    const snapshotId = await installSnapshot(context.platform);
    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toMatchObject({ availability: 'ready', snapshotId });
    expect(capabilities.features.basemap).toEqual({ available: true, version: snapshotId });
    expect(dataset).toMatchObject({ snapshotId, state: 'ready' });
  });

  it('reports a missing snapshot as unavailable rather than as not installed', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    await rm(join(context.dataRoot, 'slots', 'blue'), { force: true, recursive: true });

    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toMatchObject({ availability: 'unavailable', reason: 'snapshot_missing' });
    // The distinction matters: an operator must see that something is broken, not that nothing
    // was ever installed.
    expect(basemap).not.toMatchObject({ availability: 'not_installed' });
    expect(capabilities.features.basemap).toEqual({
      available: false,
      reason: 'dataset_unavailable',
    });
    expect(dataset).toMatchObject({ state: 'degraded' });
  });

  it('reports a snapshot that does not match the pointer as a mismatch', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    const second = await context.platform.datasets.prepareUpdate({
      inputs: [],
      sourceName: 'second',
    });
    // Rewrite the active pointer to name a snapshot stored in the other slot.
    await writeFile(
      join(context.dataRoot, 'active.json'),
      JSON.stringify({
        activatedAt: new Date().toISOString(),
        previous: null,
        schemaVersion: 1,
        slot: 'blue',
        snapshotId: second,
      }),
    );

    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toMatchObject({ availability: 'unavailable', reason: 'snapshot_mismatch' });
    expect(capabilities.features.basemap).toEqual({
      available: false,
      reason: 'dataset_unavailable',
    });
    expect(dataset).toMatchObject({ snapshotId: second, state: 'degraded' });
  });

  it('reports a corrupt active snapshot as unavailable', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    await writeFile(join(context.dataRoot, 'slots', 'blue', 'manifest.json'), '{"broken":true}');

    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toMatchObject({ availability: 'unavailable', reason: 'snapshot_corrupt' });
    expect(capabilities.features.basemap).toEqual({
      available: false,
      reason: 'dataset_unavailable',
    });
    expect(dataset).toMatchObject({ state: 'degraded' });
  });

  it('reports a corrupt active pointer as unavailable', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    await writeFile(join(context.dataRoot, 'active.json'), 'not json at all');

    const { basemap, capabilities, dataset } = await surfaces(context);

    expect(basemap).toMatchObject({ availability: 'unavailable', reason: 'snapshot_corrupt' });
    expect(capabilities.features.basemap).toEqual({
      available: false,
      reason: 'dataset_unavailable',
    });
    expect(dataset).toMatchObject({ state: 'degraded' });
  });

  it('reports a snapshot from another region as a region mismatch', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    const foreign = createPlatform({
      dataRoot: context.dataRoot,
      offline: true,
      region: 'elsewhere',
    });

    const [basemap, capabilities, dataset] = await Promise.all([
      foreign.atlas.basemap(),
      foreign.atlas.capabilities(),
      foreign.atlas.datasetStatus(),
    ]);

    expect(basemap).toMatchObject({ availability: 'unavailable', reason: 'region_mismatch' });
    expect(capabilities.features.basemap).toEqual({
      available: false,
      reason: 'dataset_unavailable',
    });
    expect(dataset).toMatchObject({ state: 'degraded' });
  });

  it('never exposes a consumable resource in any unavailable state', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    await rm(join(context.dataRoot, 'slots', 'blue'), { force: true, recursive: true });

    const basemap = await context.platform.atlas.basemap();
    expect(basemap.availability).toBe('unavailable');
    const serialized = JSON.stringify(basemap);
    expect(serialized).not.toContain('/maps/');
    expect(serialized).not.toContain('.pmtiles');
    for (const forbidden of ['snapshotId', 'resourceUrl', 'styleDescriptorUrl', 'spriteUrl']) {
      expect(basemap).not.toHaveProperty(forbidden);
    }
  });
});
