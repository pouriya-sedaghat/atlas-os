import { createM0Platform } from '@atlas-os/platform';

import { ApplicationService } from './application.js';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';

export interface ApplicationComposition {
  readonly config: AppConfig;
  readonly service: ApplicationService;
}

export function createApplicationComposition(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): ApplicationComposition {
  const config = loadConfig(environment, workingDirectory);
  const platform = createM0Platform({ offline: config.offline, region: config.region });
  return {
    config,
    service: new ApplicationService({
      atlas: platform.atlas,
      config,
      datasets: platform.datasets,
    }),
  };
}
