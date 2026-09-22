import type { AtlasOs, BasemapDescriptor, DatasetManager } from '@atlas-os/platform';
import { PlatformError, createPlatform, createSnapshotId } from '@atlas-os/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

/**
 * Names of tools, services and vendors that must never surface in a public response.
 *
 * The archive media type `application/vnd.pmtiles` and the `mvt` vector format are deliberately
 * absent from this list: they are interchange formats the contract is required to state, in the
 * same way a response may name `image/png`. What must not leak is which software produced or
 * consumes them.
 */
const PROVIDER_NAMES = [
  'photon',
  'valhalla',
  'planetiler',
  'nominatim',
  'maplibre',
  'openmaptiles',
  'maptiler',
  'protomaps',
  'martin',
  'geoserver',
  'postgis',
  'opensearch',
] as const;

function assertContracts(_atlas: AtlasOs, _datasets: DatasetManager): void {}

describe('public platform contracts', () => {
  let context: TestPlatform;

  beforeAll(async () => {
    context = await createTestPlatform();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('satisfies the query and administration interfaces', () => {
    assertContracts(context.platform.atlas, context.platform.datasets);
  });

  it('exposes no consumable resource while the basemap is unavailable', async () => {
    const descriptor = await context.platform.atlas.basemap();
    expect(descriptor).toEqual({
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    });
    for (const forbidden of [
      'snapshotId',
      'resourceUrl',
      'styleDescriptorUrl',
      'glyphUrlTemplate',
      'spriteUrl',
      'bounds',
      'minZoom',
      'maxZoom',
    ]) {
      expect(descriptor).not.toHaveProperty(forbidden);
    }
  });

  it('returns a complete renderer-neutral descriptor once a snapshot is active', async () => {
    const snapshotId = await installSnapshot(context.platform);
    const descriptor = await context.platform.atlas.basemap();

    expect(descriptor.availability).toBe('ready');
    const ready = descriptor as Extract<BasemapDescriptor, { availability: 'ready' }>;
    expect(ready).toMatchObject({
      mediaType: 'application/vnd.pmtiles',
      snapshotId,
      vectorFormat: 'mvt',
    });
    expect(ready.resourceUrl).toBe(`/maps/v1/${snapshotId}/basemap.pmtiles`);
    expect(ready.styleDescriptorUrl).toBe(`/maps/v1/${snapshotId}/style.json`);
    expect(ready.glyphUrlTemplate).toContain('{fontstack}');
    expect(ready.glyphUrlTemplate).toContain('{range}');
    expect(ready.labelLanguages).toEqual(['fa', 'en']);
    expect(ready.maxZoom).toBeGreaterThan(ready.minZoom);
    expect(ready.bounds.east).toBeGreaterThan(ready.bounds.west);
    expect(ready.bounds.north).toBeGreaterThan(ready.bounds.south);
    expect(ready.attribution.length).toBeGreaterThan(0);
  });

  it('never names a provider in a public response', async () => {
    const payload = JSON.stringify([
      await context.platform.atlas.basemap(),
      await context.platform.atlas.capabilities(),
      await context.platform.atlas.datasetStatus(),
      await context.platform.datasets.listSnapshots(),
    ]).toLowerCase();

    for (const provider of PROVIDER_NAMES) {
      expect(payload, `public payload mentions ${provider}`).not.toContain(provider);
    }
  });

  it('keeps every non-basemap capability unavailable with a typed error', async () => {
    const { atlas } = context.platform;
    const coordinate = { latitude: 35.6892, longitude: 51.389 };

    await expect(atlas.search({ query: 'Tehran' })).rejects.toBeInstanceOf(PlatformError);
    await expect(atlas.reverseGeocode({ coordinate })).rejects.toBeInstanceOf(PlatformError);
    await expect(
      atlas.route({ mode: 'car', waypoints: [coordinate, coordinate] }),
    ).rejects.toBeInstanceOf(PlatformError);
    await expect(
      atlas.matrix({ destinations: [coordinate], mode: 'car', sources: [coordinate] }),
    ).rejects.toBeInstanceOf(PlatformError);
    await expect(
      atlas.isochrone({ center: coordinate, contoursMinutes: [10], mode: 'car' }),
    ).rejects.toBeInstanceOf(PlatformError);
    await expect(atlas.mapMatch({ mode: 'car', trace: [coordinate] })).rejects.toBeInstanceOf(
      PlatformError,
    );
  });

  it('refuses dataset mutation in a platform composed without provisioning', async () => {
    const serving = await createTestPlatform({ provisioning: false });
    try {
      await expect(
        serving.platform.datasets.prepareUpdate({ inputs: [], sourceName: 'x' }),
      ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
      await expect(
        serving.platform.datasets.activateSnapshot(createSnapshotId('iran-fixture')),
      ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
      await expect(serving.platform.datasets.rollback()).rejects.toMatchObject({
        code: 'NOT_IMPLEMENTED',
      });
      // Read-only administration still works, so an operator tool can inspect state.
      await expect(serving.platform.datasets.listSnapshots()).resolves.toEqual([]);
      await expect(serving.platform.datasets.checkForUpdate()).resolves.toEqual({
        retryable: true,
        state: 'offline',
      });
    } finally {
      await serving.cleanup();
    }
  });
});

describe('platform composition', () => {
  it('reports a dataset from another region as degraded rather than serving it', async () => {
    const context = await createTestPlatform();
    try {
      await installSnapshot(context.platform);
      // A second platform reading the same data root but configured for a different region.
      const foreign = createPlatform({
        dataRoot: context.dataRoot,
        offline: true,
        region: 'elsewhere',
      });
      await expect(foreign.atlas.datasetStatus()).resolves.toMatchObject({ state: 'degraded' });
      // Truthfully unavailable rather than "never installed": a dataset is present, it simply
      // covers a different region.
      await expect(foreign.atlas.basemap()).resolves.toMatchObject({
        availability: 'unavailable',
        reason: 'region_mismatch',
      });
    } finally {
      await context.cleanup();
    }
  });
});
