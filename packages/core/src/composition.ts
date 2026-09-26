import type { SearchHostHandle } from '@atlas-os/platform';
import {
  createPlatform,
  createSearchHost,
  runSearchProbeSelection as runPlatformProbeSelection,
} from '@atlas-os/platform';

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

export interface SearchHostComposition {
  readonly config: AppConfig;
  readonly host: SearchHostHandle;
}

/**
 * Composes the private search host for one slot.
 *
 * Core supplies only the shared configuration, the data root and the region; which slot the host
 * serves and how its engine runs are the platform's own configuration, read from the environment
 * passed through here without interpretation.
 */
export function createSearchHostComposition(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
  log: (event: Readonly<Record<string, unknown>>) => void = (event) =>
    process.stdout.write(`${JSON.stringify(event)}\n`),
): SearchHostComposition {
  const config = loadConfig(environment, workingDirectory);
  return {
    config,
    host: createSearchHost({
      dataRoot: config.dataRoot,
      environment,
      log,
      region: config.region,
    }),
  };
}

/**
 * Build-time verification of a freshly prepared search database, run by the search host image
 * during an explicit preparation. The platform reads everything it needs from the environment.
 */
export async function runSearchProbeSelection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  await runPlatformProbeSelection(environment);
}
