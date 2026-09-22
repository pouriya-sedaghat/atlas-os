import type { AtlasOs, Capabilities, DatasetManager, DatasetStatus } from '@atlas-os/platform';

import type { AppConfig } from './config.js';
import { mapPlatformError } from './errors.js';

export interface ReadinessResult {
  readonly ready: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly status: 'pass' | 'warn' | 'fail';
    readonly message: string;
  }[];
}

export interface DoctorResult {
  readonly healthy: boolean;
  readonly checks: ReadinessResult['checks'];
}

export class ApplicationService {
  readonly #atlas: AtlasOs;
  readonly #config: AppConfig;
  readonly #datasets: DatasetManager;

  constructor(dependencies: {
    readonly atlas: AtlasOs;
    readonly config: AppConfig;
    readonly datasets: DatasetManager;
  }) {
    this.#atlas = dependencies.atlas;
    this.#config = dependencies.config;
    this.#datasets = dependencies.datasets;
  }

  async capabilities(): Promise<Capabilities> {
    return this.#invoke(() => this.#atlas.capabilities());
  }

  async datasetStatus(): Promise<DatasetStatus> {
    return this.#invoke(() => this.#atlas.datasetStatus());
  }

  async readiness(): Promise<ReadinessResult> {
    const dataset = await this.datasetStatus();
    return {
      ready: true,
      checks: [
        {
          message: `Profile ${this.#config.profile} is valid.`,
          name: 'configuration',
          status: 'pass',
        },
        {
          message:
            dataset.state === 'not_installed'
              ? 'No geospatial dataset is installed; this is expected in M0.'
              : `Dataset state is ${dataset.state}.`,
          name: 'dataset',
          status: dataset.state === 'degraded' ? 'warn' : 'pass',
        },
      ],
    };
  }

  async doctor(): Promise<DoctorResult> {
    const readiness = await this.readiness();
    const updateState = await this.#invoke(() => this.#datasets.checkForUpdate());
    const updateCheck = {
      message:
        updateState.state === 'offline'
          ? 'Update connectivity is offline; runtime service remains healthy.'
          : `Update state is ${updateState.state}.`,
      name: 'update_connectivity',
      status: 'pass' as const,
    };
    return { healthy: readiness.ready, checks: [...readiness.checks, updateCheck] };
  }

  async #invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapPlatformError(error);
    }
  }
}
