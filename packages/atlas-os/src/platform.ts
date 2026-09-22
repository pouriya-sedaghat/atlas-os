import type {
  AtlasOs,
  BasemapDescriptor,
  Capabilities,
  CapabilityState,
  DatasetManager,
  DatasetStatus,
  IsochroneRequest,
  IsochroneResult,
  MapMatchRequest,
  MapMatchResult,
  MatrixRequest,
  MatrixResult,
  PlaceResult,
  ReverseGeocodeRequest,
  RouteRequest,
  RouteResult,
  SearchRequest,
  SnapshotDescription,
  SnapshotId,
  SnapshotPreparationRequest,
  UpdateCheckResult,
  ValidationReport,
} from './contracts.js';
import { PlatformError } from './errors.js';
import {
  NOT_INSTALLED_BASEMAP,
  readyBasemapDescriptor,
  unavailableBasemap,
} from './internal/basemap/descriptor.js';
import { resolveDataset } from './internal/basemap/availability.js';
import type { SnapshotStore } from './internal/snapshot/store.js';
import type { BasemapPreparationRequest } from './provisioning.js';
import type { BasemapProvisioner } from './provisioning.js';

const NOT_INSTALLED: CapabilityState = { available: false, reason: 'not_installed' };
const DATASET_UNAVAILABLE: CapabilityState = { available: false, reason: 'dataset_unavailable' };

function capabilityUnavailable(name: string): never {
  throw new PlatformError('CAPABILITY_UNAVAILABLE', `The ${name} capability is not installed.`, {
    details: { capability: name },
  });
}

/**
 * Reads the active snapshot and answers the public query contracts from it.
 *
 * Every answer is derived from what is actually on disk: when no snapshot is active, or the
 * active one carries no basemap, the platform says so truthfully rather than inventing a URL.
 */
export class LocalAtlasOs implements AtlasOs {
  readonly #region: string;
  readonly #store: SnapshotStore;

  constructor(options: { readonly region: string; readonly store: SnapshotStore }) {
    this.#region = options.region;
    this.#store = options.store;
  }

  async capabilities(): Promise<Capabilities> {
    const resolution = await resolveDataset(this.#store, this.#region);
    const basemap: CapabilityState =
      resolution.state === 'ready'
        ? { available: true, version: resolution.manifest.snapshotId }
        : resolution.state === 'absent'
          ? NOT_INSTALLED
          : DATASET_UNAVAILABLE;

    return {
      features: {
        basemap,
        isochrones: NOT_INSTALLED,
        map_matching: NOT_INSTALLED,
        matrix: NOT_INSTALLED,
        reverse_geocoding: NOT_INSTALLED,
        routing: NOT_INSTALLED,
        search: NOT_INSTALLED,
      },
      schemaVersion: 1,
    };
  }

  async datasetStatus(): Promise<DatasetStatus> {
    const resolution = await resolveDataset(this.#store, this.#region);
    if (resolution.state === 'absent') {
      return { region: this.#region, state: 'not_installed' };
    }
    if (resolution.state === 'unavailable') {
      return {
        reason: resolution.detail,
        region: this.#region,
        snapshotId: resolution.snapshotId as SnapshotId | null,
        state: 'degraded',
      };
    }
    return {
      activatedAt: resolution.activatedAt,
      region: this.#region,
      snapshotId: resolution.manifest.snapshotId,
      state: 'ready',
    };
  }

  async basemap(): Promise<BasemapDescriptor> {
    const resolution = await resolveDataset(this.#store, this.#region);
    if (resolution.state === 'absent') return NOT_INSTALLED_BASEMAP;
    if (resolution.state === 'unavailable') {
      return unavailableBasemap(resolution.reason, resolution.detail);
    }
    const descriptor = readyBasemapDescriptor(resolution.manifest);
    // A ready resolution always carries a basemap component, so this is unreachable in practice;
    // it keeps the surfaces consistent rather than inventing a ready descriptor.
    return descriptor ?? unavailableBasemap('basemap_missing', 'The snapshot carries no basemap.');
  }

  async search(_request: SearchRequest): Promise<readonly PlaceResult[]> {
    return capabilityUnavailable('search');
  }

  async reverseGeocode(_request: ReverseGeocodeRequest): Promise<PlaceResult> {
    return capabilityUnavailable('reverse geocoding');
  }

  async route(_request: RouteRequest): Promise<RouteResult> {
    return capabilityUnavailable('routing');
  }

  async matrix(_request: MatrixRequest): Promise<MatrixResult> {
    return capabilityUnavailable('matrix');
  }

  async isochrone(_request: IsochroneRequest): Promise<IsochroneResult> {
    return capabilityUnavailable('isochrone');
  }

  async mapMatch(_request: MapMatchRequest): Promise<MapMatchResult> {
    return capabilityUnavailable('map matching');
  }
}

/**
 * Administrative half of the platform. Kept separate from the query façade so a user-facing
 * request path can never reach a dataset mutation.
 */
export class LocalDatasetManager implements DatasetManager {
  readonly #offline: boolean;
  readonly #provisioner: BasemapProvisioner | undefined;
  readonly #store: SnapshotStore;

  constructor(options: {
    readonly offline: boolean;
    readonly provisioner: BasemapProvisioner | undefined;
    readonly store: SnapshotStore;
  }) {
    this.#offline = options.offline;
    this.#provisioner = options.provisioner;
    this.#store = options.store;
  }

  /**
   * A process composed without provisioning cannot build or publish datasets. Reporting that as
   * a typed refusal keeps the request-serving processes structurally incapable of mutating the
   * dataset, rather than relying on no route being registered.
   */
  #requireProvisioner(): BasemapProvisioner {
    if (this.#provisioner === undefined) {
      throw new PlatformError(
        'NOT_IMPLEMENTED',
        'This process is not configured for dataset provisioning.',
      );
    }
    return this.#provisioner;
  }

  /**
   * M1 has no downloader and no scheduled network access: provisioning is explicit and operator
   * initiated, so the absence of connectivity is reported as an update condition, never as a
   * runtime failure.
   */
  async checkForUpdate(): Promise<UpdateCheckResult> {
    return this.#offline ? { retryable: true, state: 'offline' } : { state: 'not_configured' };
  }

  async prepareUpdate(request: SnapshotPreparationRequest): Promise<SnapshotId> {
    const preparation: BasemapPreparationRequest = {
      inputs: request.inputs,
      sourceName: request.sourceName,
      sourceTimestamp: request.sourceTimestamp,
    };
    return this.#requireProvisioner().prepare(preparation);
  }

  async validateSnapshot(id: SnapshotId): Promise<ValidationReport> {
    return this.#requireProvisioner().validate(id);
  }

  async activateSnapshot(id: SnapshotId): Promise<void> {
    return this.#requireProvisioner().activate(id);
  }

  async rollback(): Promise<void> {
    return this.#requireProvisioner().rollback();
  }

  async listSnapshots(): Promise<readonly SnapshotDescription[]> {
    const pointer = await this.#store.readActivePointer();
    const records = await this.#store.list();
    return records.map((record) => ({
      active: pointer?.snapshotId === record.manifest.snapshotId,
      createdAt: record.manifest.createdAt,
      hasBasemap: record.manifest.basemap !== undefined,
      region: record.manifest.region,
      snapshotId: record.manifest.snapshotId,
      source: {
        name: record.manifest.source.name,
        timestamp: record.manifest.source.timestamp,
      },
      validation: record.manifest.validation,
    }));
  }
}
