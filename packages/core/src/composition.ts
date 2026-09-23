import { createPlatform } from '@atlas-os/platform';

import { ApplicationService } from './application.js';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { loadRegionDescriptor } from './region.js';

export interface ApplicationComposition {
  readonly config: AppConfig;
  readonly service: ApplicationService;
}

/**
 * Composes a request-serving application.
 *
 * No provisioning options are supplied, so the resulting platform is structurally unable to
 * prepare, activate or roll back a dataset. Startup performs no filesystem or network work
 * beyond validating configuration: a missing dataset is discovered lazily and reported as a
 * state, never as a startup failure.
 */
export function createApplicationComposition(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): ApplicationComposition {
  const config = loadConfig(environment, workingDirectory);
  const platform = createPlatform({
    dataRoot: config.dataRoot,
    environment,
    offline: config.offline,
    region: config.region,
  });
  return {
    config,
    service: new ApplicationService({
      atlas: platform.atlas,
      config,
      datasets: platform.datasets,
      resources: platform.resources,
    }),
  };
}

/**
 * Composes an operator tool that may build and publish datasets.
 *
 * This reads the region descriptor for geography and label languages, and is used only by the
 * command-line tool. Request-serving processes never call it.
 */
export async function createProvisioningComposition(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): Promise<ApplicationComposition> {
  const config = loadConfig(environment, workingDirectory);
  const region = await loadRegionDescriptor(config.regionConfigPath, config.region);
  const platform = createPlatform({
    dataRoot: config.dataRoot,
    // Passed through without interpretation: the platform reads its own provisioning tooling
    // configuration from it. Core does not know which tool exists or how it is executed.
    environment,
    offline: config.offline,
    provisioning: {
      bounds: region.bounds,
      fontPath: config.fontPath,
      labelLanguages: region.defaultLabelLanguages,
    },
    region: config.region,
  });
  return {
    config,
    service: new ApplicationService({
      atlas: platform.atlas,
      config,
      datasets: platform.datasets,
      resources: platform.resources,
    }),
  };
}
