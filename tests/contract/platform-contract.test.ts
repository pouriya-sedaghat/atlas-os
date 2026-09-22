import type { AtlasOs, BasemapDescriptor, DatasetManager } from '@atlas-os/platform';
import { createM0Platform, createSnapshotId, PlatformError } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

function assertContracts(_atlas: AtlasOs, _datasets: DatasetManager): void {}

describe('M0 public contracts', () => {
  it('satisfies the query and administration interfaces', () => {
    const platform = createM0Platform({ offline: true, region: 'iran' });
    assertContracts(platform.atlas, platform.datasets);
  });

  it('does not expose consumable resources when the basemap is unavailable', async () => {
    const { atlas } = createM0Platform({ offline: true, region: 'iran' });
    const descriptor = await atlas.basemap();
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
    ]) {
      expect(descriptor).not.toHaveProperty(forbidden);
    }
    const serialized = JSON.stringify(descriptor).toLowerCase();
    for (const provider of ['photon', 'valhalla', 'planetiler', 'nominatim', 'maplibre']) {
      expect(serialized).not.toContain(provider);
    }
  });

  it('requires complete provider-neutral MVT-in-PMTiles metadata when ready', () => {
    const descriptor: Extract<BasemapDescriptor, { availability: 'ready' }> = {
      availability: 'ready',
      attribution: 'Fixture attribution',
      bounds: { east: 63.333, north: 39.782, south: 24.397, west: 44.033 },
      glyphUrlTemplate: '/maps/fixture/glyphs/{fontstack}/{range}.pbf',
      labelLanguages: ['fa', 'en'],
      maxZoom: 14,
      mediaType: 'application/vnd.pmtiles',
      minZoom: 0,
      resourceUrl: '/maps/fixture/basemap.pmtiles',
      snapshotId: createSnapshotId('fixture-snapshot'),
      spriteUrl: '/maps/fixture/sprites/default',
      styleDescriptorUrl: '/maps/fixture/styles/default.json',
      vectorFormat: 'mvt',
    };
    expect(descriptor).toMatchObject({
      availability: 'ready',
      mediaType: 'application/vnd.pmtiles',
      vectorFormat: 'mvt',
    });
  });

  it('uses typed unavailable errors for uninstalled query capabilities', async () => {
    const { atlas } = createM0Platform({ offline: true, region: 'iran' });
    await expect(atlas.search({ query: 'Tehran' })).rejects.toBeInstanceOf(PlatformError);
  });
});
