export type SnapshotId = string & { readonly __snapshotId: unique symbol };

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeographicBounds {
  readonly east: number;
  readonly north: number;
  readonly south: number;
  readonly west: number;
}

export type CapabilityState =
  | { readonly available: true; readonly version: string }
  | {
      readonly available: false;
      readonly reason: 'not_installed' | 'dataset_unavailable' | 'disabled';
    };

export type CapabilityName =
  | 'basemap'
  | 'search'
  | 'reverse_geocoding'
  | 'routing'
  | 'matrix'
  | 'isochrones'
  | 'map_matching';

export interface Capabilities {
  readonly schemaVersion: 1;
  readonly features: Readonly<Record<CapabilityName, CapabilityState>>;
}

export type DatasetStatus =
  | { readonly state: 'not_installed'; readonly region: string }
  | {
      readonly state: 'ready';
      readonly region: string;
      readonly snapshotId: SnapshotId;
      readonly activatedAt: string;
    }
  | {
      readonly state: 'updating';
      readonly region: string;
      readonly activeSnapshotId: SnapshotId | null;
      readonly candidateSnapshotId: SnapshotId;
    }
  | {
      readonly state: 'degraded';
      readonly region: string;
      readonly snapshotId: SnapshotId | null;
      readonly reason: string;
    };

export type BasemapDescriptor =
  | {
      readonly availability: 'not_installed';
      readonly reason: 'dataset_not_installed';
    }
  | {
      readonly availability: 'ready';
      readonly attribution: string;
      readonly bounds: GeographicBounds;
      readonly glyphUrlTemplate: string;
      readonly labelLanguages: readonly string[];
      readonly maxZoom: number;
      readonly mediaType: 'application/vnd.pmtiles';
      readonly minZoom: number;
      readonly resourceUrl: string;
      readonly snapshotId: SnapshotId;
      readonly spriteUrl: string;
      readonly styleDescriptorUrl: string;
      readonly vectorFormat: 'mvt';
    };

export interface SearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly language?: string;
  readonly near?: Coordinate;
}

export interface ReverseGeocodeRequest {
  readonly coordinate: Coordinate;
  readonly language?: string;
}

export interface PlaceResult {
  readonly id: string;
  readonly name: string;
  readonly coordinate: Coordinate;
  readonly category: string;
  readonly address: Readonly<Record<string, string>>;
}

export type TravelMode = 'car' | 'bicycle' | 'pedestrian';

export interface RouteRequest {
  readonly waypoints: readonly [Coordinate, Coordinate, ...Coordinate[]];
  readonly mode: TravelMode;
}

export interface RouteResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: readonly Coordinate[];
}

export interface MatrixRequest {
  readonly sources: readonly Coordinate[];
  readonly destinations: readonly Coordinate[];
  readonly mode: TravelMode;
}

export interface MatrixResult {
  readonly durationsSeconds: readonly (readonly (number | null)[])[];
  readonly distancesMeters: readonly (readonly (number | null)[])[];
}

export interface IsochroneRequest {
  readonly center: Coordinate;
  readonly contoursMinutes: readonly number[];
  readonly mode: TravelMode;
}

export interface IsochroneResult {
  readonly contours: readonly {
    readonly minutes: number;
    readonly rings: readonly (readonly Coordinate[])[];
  }[];
}

export interface MapMatchRequest {
  readonly trace: readonly Coordinate[];
  readonly mode: TravelMode;
}

export interface MapMatchResult {
  readonly confidence: number;
  readonly matchedPath: readonly Coordinate[];
}

export type UpdateCheckResult =
  | { readonly state: 'available'; readonly version: string }
  | { readonly state: 'current' }
  | { readonly state: 'offline'; readonly retryable: true }
  | { readonly state: 'not_configured' }
  | { readonly state: 'deferred'; readonly reason: string };

export interface ValidationReport {
  readonly valid: boolean;
  readonly checkedAt: string;
  readonly checks: readonly {
    readonly name: string;
    readonly status: 'passed' | 'failed';
    readonly message: string;
  }[];
}

export interface AtlasOs {
  capabilities(): Promise<Capabilities>;
  datasetStatus(): Promise<DatasetStatus>;
  search(request: SearchRequest): Promise<readonly PlaceResult[]>;
  reverseGeocode(request: ReverseGeocodeRequest): Promise<PlaceResult>;
  route(request: RouteRequest): Promise<RouteResult>;
  matrix(request: MatrixRequest): Promise<MatrixResult>;
  isochrone(request: IsochroneRequest): Promise<IsochroneResult>;
  mapMatch(request: MapMatchRequest): Promise<MapMatchResult>;
  basemap(): Promise<BasemapDescriptor>;
}

export interface DatasetManager {
  checkForUpdate(): Promise<UpdateCheckResult>;
  prepareUpdate(): Promise<SnapshotId>;
  validateSnapshot(id: SnapshotId): Promise<ValidationReport>;
  activateSnapshot(id: SnapshotId): Promise<void>;
  rollback(): Promise<void>;
}
