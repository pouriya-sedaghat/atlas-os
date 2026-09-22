import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const GEOSPATIAL_FEATURES = [
  'basemap',
  'isochrones',
  'map_matching',
  'matrix',
  'reverse_geocoding',
  'routing',
  'search',
] as const;

describe('capability representation', () => {
  let context: TestPlatform;

  beforeAll(async () => {
    context = await createTestPlatform();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('reports every capability as not installed before a dataset exists', async () => {
    const capabilities = await context.platform.atlas.capabilities();
    expect(Object.keys(capabilities.features).sort()).toEqual([...GEOSPATIAL_FEATURES]);
    for (const [name, state] of Object.entries(capabilities.features)) {
      expect(state, `capability ${name}`).toEqual({ available: false, reason: 'not_installed' });
    }
  });

  it('reports only the basemap as available once a snapshot is active', async () => {
    const snapshotId = await installSnapshot(context.platform);
    const capabilities = await context.platform.atlas.capabilities();

    expect(capabilities.features.basemap).toEqual({ available: true, version: snapshotId });
    for (const name of GEOSPATIAL_FEATURES.filter((feature) => feature !== 'basemap')) {
      expect(capabilities.features[name], `capability ${name}`).toEqual({
        available: false,
        reason: 'not_installed',
      });
    }
  });
});
