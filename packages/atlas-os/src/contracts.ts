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

/** Why an installed dataset cannot currently serve a basemap. */
export type BasemapUnavailableReason =
  /** The active pointer names a snapshot that is not on disk. */
  | 'snapshot_missing'
  /** The stored snapshot does not match the active pointer. */
  | 'snapshot_mismatch'
  /** The snapshot could not be read or does not satisfy its schema. */
  | 'snapshot_corrupt'
  /** The snapshot covers a different region than this host is configured for. */
  | 'region_mismatch'
  /** The snapshot is present and valid but carries no basemap component. */
  | 'basemap_missing';

export type BasemapDescriptor =
  /** No dataset has ever been activated on this host. */
  | {
      readonly availability: 'not_installed';
      readonly reason: 'dataset_not_installed';
    }
  /**
   * A dataset is installed but cannot serve a basemap. Distinguished from `not_installed` so an
   * operator sees that something is wrong rather than that nothing is there. Like
   * `not_installed`, it exposes no consumable resource.
   */
  | {
      readonly availability: 'unavailable';
      readonly reason: BasemapUnavailableReason;
      readonly detail: string;
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

/**
 * Role an operator-supplied input plays in a dataset preparation.
 *
 * These name what the data *is*, never which project publishes it or which tool consumes it.
 * Mapping a role onto a particular tool's input is private to the platform.
 */
export type DatasetInputKind =
  /** The regional OpenStreetMap extract the dataset is built from. */
  | 'region_extract'
  /** Small-scale reference geometry used for low-zoom boundaries, places and landcover. */
  | 'reference_features'
  /** Pre-processed coastline and ocean polygons. */
  | 'coastline_polygons'
  /** Centreline geometry used to label large water bodies. */
  | 'lake_centerlines';

/** One operator-supplied input, resolved on the host that runs the preparation. */
export interface DatasetInput {
  readonly kind: DatasetInputKind;
  /** Human-readable name of this input, recorded for provenance. */
  readonly name: string;
  /** Absolute path to the file on the provisioning host. */
  readonly path: string;
  /** Publisher timestamp of this input, ISO-8601. */
  readonly timestamp?: string | undefined;
}

/** Recorded provenance for one input, after it has been read and hashed. */
export interface DatasetInputProvenance {
  readonly bytes: number;
  readonly checksum: string;
  /** File name only; absolute host paths are never recorded or published. */
  readonly filename: string;
  readonly kind: DatasetInputKind;
  readonly name: string;
  readonly timestamp: string | null;
}

/**
 * Request to prepare a new dataset snapshot.
 *
 * Deliberately neutral: it names the inputs and where to find them, never the tool that will
 * process them or the tile schema that will come out. A preparation that is missing an input its
 * selected content requires is refused rather than silently producing an incomplete dataset.
 */
export interface SnapshotPreparationRequest {
  /** Human-readable name of the preparation as a whole, recorded for provenance. */
  readonly sourceName: string;
  /** Operator-supplied inputs. */
  readonly inputs: readonly DatasetInput[];
  /** Publisher timestamp of the primary input, ISO-8601. */
  readonly sourceTimestamp?: string | undefined;
}

/** Summary of a stored snapshot, for administrative listing. */
export interface SnapshotDescription {
  readonly active: boolean;
  readonly createdAt: string;
  readonly hasBasemap: boolean;
  readonly region: string;
  readonly snapshotId: SnapshotId;
  readonly source: { readonly name: string; readonly timestamp: string };
  readonly validation: 'pending' | 'passed' | 'failed';
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly checkedAt: string;
  readonly checks: readonly {
    readonly name: string;
    readonly status: 'passed' | 'failed';
    readonly message: string;
  }[];
}

/** A request for a versioned basemap resource, relative to the resource route prefix. */
export interface BasemapResourceRequest {
  readonly method: 'GET' | 'HEAD';
  /** Path below the resource prefix, still percent-encoded as received. */
  readonly path: string;
  readonly rangeHeader?: string | undefined;
}

export interface BasemapResourceHeaders {
  readonly acceptRanges: 'bytes';
  readonly cacheControl: string;
  readonly contentLength: number;
  readonly contentRange?: string;
  readonly contentType: string;
}

/**
 * Outcome of a basemap resource read.
 *
 * Expected HTTP conditions are values rather than exceptions, so the transport maps them without
 * inspecting error messages, and every branch is directly testable.
 */
export type BasemapResourceResult =
  | {
      readonly outcome: 'ok';
      readonly status: 200 | 206;
      readonly headers: BasemapResourceHeaders;
      /** Bounded stream of the requested bytes; `null` for a HEAD request. */
      readonly body: NodeJS.ReadableStream | null;
    }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'invalid_request'; readonly reason: string }
  | {
      readonly outcome: 'range_not_satisfiable';
      readonly contentRange: string;
      readonly contentType: string;
    }
  | { readonly outcome: 'unavailable' };

/** Serves the local, versioned resources that back the active basemap. */
export interface BasemapResourceReader {
  read(request: BasemapResourceRequest): Promise<BasemapResourceResult>;
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
  prepareUpdate(request: SnapshotPreparationRequest): Promise<SnapshotId>;
  validateSnapshot(id: SnapshotId): Promise<ValidationReport>;
  activateSnapshot(id: SnapshotId): Promise<void>;
  rollback(): Promise<void>;
  listSnapshots(): Promise<readonly SnapshotDescription[]>;
}
