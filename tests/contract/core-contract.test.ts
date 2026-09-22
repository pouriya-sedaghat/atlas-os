import { ApplicationService, loadConfig } from '@atlas-os/core';
import type { AtlasOs, DatasetManager } from '@atlas-os/platform';
import { PlatformError, createM0Platform } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

describe('core application boundary', () => {
  it('maps platform errors into application errors', async () => {
    const platform = createM0Platform({ offline: true, region: 'iran' });
    const failingAtlas: AtlasOs = {
      basemap: () => platform.atlas.basemap(),
      capabilities: () =>
        Promise.reject(new PlatformError('DATASET_UNAVAILABLE', 'Dataset unavailable.')),
      datasetStatus: () => platform.atlas.datasetStatus(),
      isochrone: (request) => platform.atlas.isochrone(request),
      mapMatch: (request) => platform.atlas.mapMatch(request),
      matrix: (request) => platform.atlas.matrix(request),
      reverseGeocode: (request) => platform.atlas.reverseGeocode(request),
      route: (request) => platform.atlas.route(request),
      search: (request) => platform.atlas.search(request),
    };
    const service = new ApplicationService({
      atlas: failingAtlas,
      config: loadConfig({}),
      datasets: platform.datasets,
    });
    await expect(service.capabilities()).rejects.toMatchObject({
      code: 'FEATURE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('supports dependency-injected contract doubles', async () => {
    const platform = createM0Platform({ offline: true, region: 'iran' });
    const datasets: DatasetManager = {
      activateSnapshot: (id) => platform.datasets.activateSnapshot(id),
      checkForUpdate: () => Promise.resolve({ state: 'deferred', reason: 'maintenance window' }),
      prepareUpdate: () => platform.datasets.prepareUpdate(),
      rollback: () => platform.datasets.rollback(),
      validateSnapshot: (id) => platform.datasets.validateSnapshot(id),
    };
    const service = new ApplicationService({
      atlas: platform.atlas,
      config: loadConfig({}),
      datasets,
    });
    await expect(service.doctor()).resolves.toMatchObject({ healthy: true });
  });
});
