import type {
  AtlasOs,
  BasemapDescriptor,
  Capabilities,
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
  SnapshotId,
  UpdateCheckResult,
  ValidationReport,
} from './contracts.js';
import { PlatformError } from './errors.js';

const unavailable = { available: false, reason: 'not_installed' } as const;

export const m0Capabilities: Capabilities = {
  schemaVersion: 1,
  features: {
    basemap: unavailable,
    isochrones: unavailable,
    map_matching: unavailable,
    matrix: unavailable,
    reverse_geocoding: unavailable,
    routing: unavailable,
    search: unavailable,
  },
};

function capabilityUnavailable(name: string): never {
  throw new PlatformError('CAPABILITY_UNAVAILABLE', `${name} is not installed in M0.`, {
    details: { capability: name, milestone: 'M0' },
  });
}

export class M0AtlasOs implements AtlasOs {
  readonly #region: string;

  constructor(region = 'iran') {
    this.#region = region;
  }

  async capabilities(): Promise<Capabilities> {
    return m0Capabilities;
  }

  async datasetStatus(): Promise<DatasetStatus> {
    return { region: this.#region, state: 'not_installed' };
  }

  async basemap(): Promise<BasemapDescriptor> {
    return {
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    };
  }

  async search(_request: SearchRequest): Promise<readonly PlaceResult[]> {
    return capabilityUnavailable('search');
  }

  async reverseGeocode(_request: ReverseGeocodeRequest): Promise<PlaceResult> {
    return capabilityUnavailable('reverse_geocoding');
  }

  async route(_request: RouteRequest): Promise<RouteResult> {
    return capabilityUnavailable('routing');
  }

  async matrix(_request: MatrixRequest): Promise<MatrixResult> {
    return capabilityUnavailable('matrix');
  }

  async isochrone(_request: IsochroneRequest): Promise<IsochroneResult> {
    return capabilityUnavailable('isochrones');
  }

  async mapMatch(_request: MapMatchRequest): Promise<MapMatchResult> {
    return capabilityUnavailable('map_matching');
  }
}

export class M0DatasetManager implements DatasetManager {
  readonly #offline: boolean;

  constructor(offline: boolean) {
    this.#offline = offline;
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    return this.#offline ? { retryable: true, state: 'offline' } : { state: 'not_configured' };
  }

  async prepareUpdate(): Promise<SnapshotId> {
    return this.#notImplemented();
  }

  async validateSnapshot(_id: SnapshotId): Promise<ValidationReport> {
    return this.#notImplemented();
  }

  async activateSnapshot(_id: SnapshotId): Promise<void> {
    return this.#notImplemented();
  }

  async rollback(): Promise<void> {
    return this.#notImplemented();
  }

  #notImplemented(): never {
    throw new PlatformError('NOT_IMPLEMENTED', 'Dataset mutation is not implemented in M0.', {
      details: { milestone: 'M0' },
    });
  }
}

export function createM0Platform(options: { readonly offline: boolean; readonly region: string }): {
  readonly atlas: AtlasOs;
  readonly datasets: DatasetManager;
} {
  return {
    atlas: new M0AtlasOs(options.region),
    datasets: new M0DatasetManager(options.offline),
  };
}
