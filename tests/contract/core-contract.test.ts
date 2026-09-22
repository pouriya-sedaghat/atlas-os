import { ApplicationService, loadConfig } from '@atlas-os/core';
import type { AtlasOs, BasemapResourceReader, DatasetManager } from '@atlas-os/platform';
import { PlatformError, createPlatform } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];

async function platformContext(): Promise<TestPlatform> {
  const context = await createTestPlatform();
  contexts.push(context);
  return context;
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

function service(dependencies: {
  atlas: AtlasOs;
  datasets: DatasetManager;
  resources: BasemapResourceReader;
}): ApplicationService {
  return new ApplicationService({ ...dependencies, config: loadConfig({}) });
}

describe('core application boundary', () => {
  it('maps platform errors into application errors', async () => {
    const context = await platformContext();
    const failing: AtlasOs = {
      ...context.platform.atlas,
      basemap: () => context.platform.atlas.basemap(),
      capabilities: () =>
        Promise.reject(new PlatformError('DATASET_UNAVAILABLE', 'Dataset unavailable.')),
      datasetStatus: () => context.platform.atlas.datasetStatus(),
    };

    await expect(
      service({
        atlas: failing,
        datasets: context.platform.datasets,
        resources: context.platform.resources,
      }).capabilities(),
    ).rejects.toMatchObject({ code: 'FEATURE_UNAVAILABLE', statusCode: 503 });
  });

  it.each([
    ['NOT_FOUND', 'NOT_FOUND', 404],
    ['CONFLICT', 'CONFLICT', 409],
    ['VALIDATION_FAILED', 'BAD_REQUEST', 400],
    ['NOT_IMPLEMENTED', 'NOT_IMPLEMENTED', 501],
  ] as const)('maps a platform %s to an application %s', async (platformCode, appCode, status) => {
    const context = await platformContext();
    const failing: AtlasOs = {
      ...context.platform.atlas,
      basemap: () => Promise.reject(new PlatformError(platformCode, 'failed')),
    };

    await expect(
      service({
        atlas: failing,
        datasets: context.platform.datasets,
        resources: context.platform.resources,
      }).basemap(),
    ).rejects.toMatchObject({ code: appCode, statusCode: status });
  });

  it('passes a ready basemap descriptor through unchanged', async () => {
    const context = await platformContext();
    const snapshotId = await installSnapshot(context.platform);
    const result = await service({
      atlas: context.platform.atlas,
      datasets: context.platform.datasets,
      resources: context.platform.resources,
    }).basemap();

    expect(result).toEqual(await context.platform.atlas.basemap());
    expect(result).toMatchObject({ availability: 'ready', snapshotId });
  });

  it('supports dependency-injected contract doubles', async () => {
    const context = await platformContext();
    const datasets: DatasetManager = {
      ...context.platform.datasets,
      checkForUpdate: () => Promise.resolve({ reason: 'maintenance window', state: 'deferred' }),
    };

    await expect(
      service({
        atlas: context.platform.atlas,
        datasets,
        resources: context.platform.resources,
      }).doctor(),
    ).resolves.toMatchObject({ healthy: true });
  });

  it('stays ready and truthful when no dataset is installed', async () => {
    const context = await platformContext();
    const application = service({
      atlas: context.platform.atlas,
      datasets: context.platform.datasets,
      resources: context.platform.resources,
    });

    await expect(application.readiness()).resolves.toMatchObject({ ready: true });
    await expect(application.basemap()).resolves.toEqual({
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    });
    await expect(application.datasetStatus()).resolves.toMatchObject({ state: 'not_installed' });
  });

  it('reports a degraded dataset as a readiness warning without refusing traffic', async () => {
    const context = await platformContext();
    await installSnapshot(context.platform);
    const foreign = createPlatform({
      dataRoot: context.dataRoot,
      offline: true,
      region: 'elsewhere',
    });

    const readiness = await service({
      atlas: foreign.atlas,
      datasets: foreign.datasets,
      resources: foreign.resources,
    }).readiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.find((check) => check.name === 'dataset')?.status).toBe('warn');
  });
});
