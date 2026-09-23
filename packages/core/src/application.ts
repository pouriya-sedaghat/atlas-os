import type {
  AtlasOs,
  BasemapDescriptor,
  BasemapResourceReader,
  BasemapResourceRequest,
  BasemapResourceResult,
  Capabilities,
  DatasetManager,
  DatasetStatus,
  SnapshotDescription,
  SnapshotId,
  SnapshotPreparationRequest,
  ValidationReport,
} from '@atlas-os/platform';

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

/**
 * Application-level use cases.
 *
 * Applications talk to this class and never to the platform package, so provider selection,
 * dataset layout and tile tooling stay behind one boundary.
 */
export class ApplicationService {
  readonly #atlas: AtlasOs;
  readonly #config: AppConfig;
  readonly #datasets: DatasetManager;
  readonly #resources: BasemapResourceReader;

  constructor(dependencies: {
    readonly atlas: AtlasOs;
    readonly config: AppConfig;
    readonly datasets: DatasetManager;
    readonly resources: BasemapResourceReader;
  }) {
    this.#atlas = dependencies.atlas;
    this.#config = dependencies.config;
    this.#datasets = dependencies.datasets;
    this.#resources = dependencies.resources;
  }

  async capabilities(): Promise<Capabilities> {
    return this.#invoke(() => this.#atlas.capabilities());
  }

  async datasetStatus(): Promise<DatasetStatus> {
    return this.#invoke(() => this.#atlas.datasetStatus());
  }

  async basemap(): Promise<BasemapDescriptor> {
    return this.#invoke(() => this.#atlas.basemap());
  }

  /**
   * Reads a versioned basemap resource. Expected HTTP conditions come back as values, so this
   * method throws only on a genuine fault.
   */
  async basemapResource(request: BasemapResourceRequest): Promise<BasemapResourceResult> {
    return this.#invoke(() => this.#resources.read(request));
  }

  async readiness(): Promise<ReadinessResult> {
    const dataset = await this.datasetStatus();
    const datasetStatus = dataset.state === 'degraded' ? 'warn' : 'pass';
    return {
      checks: [
        {
          message: `Profile ${this.#config.profile} is valid.`,
          name: 'configuration',
          status: 'pass',
        },
        {
          message:
            dataset.state === 'not_installed'
              ? 'No dataset is installed; the application serves its status interface only.'
              : dataset.state === 'degraded'
                ? dataset.reason
                : `Dataset state is ${dataset.state}.`,
          name: 'dataset',
          status: datasetStatus,
        },
      ],
      // A missing dataset is a valid, healthy startup mode: the application is ready to serve
      // what it has. Only a dataset that is present but broken is a readiness warning.
      ready: true,
    };
  }

  async doctor(): Promise<DoctorResult> {
    const readiness = await this.readiness();
    const updateState = await this.#invoke(() => this.#datasets.checkForUpdate());
    const basemap = await this.basemap();
    return {
      checks: [
        ...readiness.checks,
        {
          message:
            updateState.state === 'offline'
              ? 'Update connectivity is offline; runtime service remains healthy.'
              : `Update state is ${updateState.state}.`,
          name: 'update_connectivity',
          status: 'pass',
        },
        {
          message:
            basemap.availability === 'ready'
              ? `Basemap snapshot ${basemap.snapshotId} is serving zoom ${basemap.minZoom}-${basemap.maxZoom}.`
              : 'No basemap is installed.',
          name: 'basemap',
          status: 'pass',
        },
      ],
      healthy: readiness.ready,
    };
  }

  // Dataset administration. Deliberately separate from the query use cases above and never
  // exposed over HTTP.

  async listSnapshots(): Promise<readonly SnapshotDescription[]> {
    return this.#invoke(() => this.#datasets.listSnapshots());
  }

  async prepareSnapshot(request: SnapshotPreparationRequest): Promise<SnapshotId> {
    return this.#invoke(() => this.#datasets.prepareUpdate(request));
  }

  async validateSnapshot(id: SnapshotId): Promise<ValidationReport> {
    return this.#invoke(() => this.#datasets.validateSnapshot(id));
  }

  async activateSnapshot(id: SnapshotId): Promise<void> {
    return this.#invoke(() => this.#datasets.activateSnapshot(id));
  }

  async rollbackSnapshot(): Promise<void> {
    return this.#invoke(() => this.#datasets.rollback());
  }

  async checkForUpdate(): ReturnType<DatasetManager['checkForUpdate']> {
    return this.#invoke(() => this.#datasets.checkForUpdate());
  }

  async #invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapPlatformError(error);
    }
  }
}
