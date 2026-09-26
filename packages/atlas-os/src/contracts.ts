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
      readonly reason: 'not_installed' | 'dataset_unavailable' | 'disabled' | 'starting';
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

/**
 * Why search or reverse geocoding cannot answer right now.
 *
 * Provider-neutral by construction: none of these names an engine, a process or a path.
 */
export type SearchUnavailableReason =
  /** No dataset is installed, or this deployment runs no search engine. */
  | 'not_installed'
  /** The active snapshot carries no search component (a basemap-only snapshot). */
  | 'component_missing'
  /** The active dataset cannot be read, or its search engine failed to load it. */
  | 'dataset_unavailable'
  /** The engine for the active snapshot is still loading it. */
  | 'starting'
  /** The engine answered for a different generation than the active snapshot. */
  | 'generation_mismatch'
  /** The active snapshot changed while the request was being answered. */
  | 'dataset_changed'
  /** The engine did not answer within the request budget. */
  | 'timeout'
  /** Too many concurrent search requests are in flight. */
  | 'saturated'
  /** The engine cannot load the active snapshot because its working volume is too small. */
  | 'insufficient_space';

/** Search availability for one snapshot, derived from the same resolution every surface uses. */
export type SearchComponentStatus =
  | { readonly state: 'ready'; readonly snapshotId: SnapshotId }
  | {
      readonly state: 'unavailable';
      readonly reason: SearchUnavailableReason;
      readonly retryable: boolean;
    };

/** The prepared snapshot waiting in the inactive slot, if any, and whether it can be searched. */
export interface StandbySnapshotStatus {
  readonly snapshotId: SnapshotId;
  readonly search: SearchComponentStatus;
}

export type DatasetStatus =
  | {
      readonly state: 'not_installed';
      readonly region: string;
      readonly search: SearchComponentStatus;
      readonly standby: StandbySnapshotStatus | null;
    }
  | {
      readonly state: 'ready';
      readonly region: string;
      readonly snapshotId: SnapshotId;
      readonly activatedAt: string;
      readonly search: SearchComponentStatus;
      readonly standby: StandbySnapshotStatus | null;
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
      readonly search: SearchComponentStatus;
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

/** Languages a caller may request search results in. */
export type SearchLanguage = 'fa' | 'en';

/**
 * A validated forward search. `query` is already canonicalised; callers build it with
 * `parseSearchParameters` rather than by hand.
 */
export interface SearchRequest {
  readonly query: string;
  readonly limit: number;
  readonly language: SearchLanguage;
  readonly near?: Coordinate;
}

/** A validated reverse geocoding request. */
export interface ReverseGeocodeRequest {
  readonly coordinate: Coordinate;
  readonly language: SearchLanguage;
}

/** Raw query parameters exactly as received, every occurrence kept so duplicates are visible. */
export type SearchParameters = Readonly<Record<string, readonly string[]>>;

export type SearchRequestField = 'q' | 'limit' | 'language' | 'lat' | 'lon' | 'parameters';

export type SearchInvalidReason =
  | 'missing'
  | 'duplicated'
  | 'unknown'
  | 'too_short'
  | 'too_long'
  | 'control_character'
  | 'not_an_integer'
  | 'not_a_number'
  | 'out_of_range'
  | 'unsupported'
  | 'incomplete_coordinate';

/** What kind of addressable thing a result is, so a client can pick a sensible zoom. */
export type PlaceKind =
  | 'house'
  | 'street'
  | 'locality'
  | 'district'
  | 'city'
  | 'county'
  | 'state'
  | 'country'
  | 'other';

export interface PlaceResult {
  /** Stable `osm:node|way|relation:<id>` identifier; never an engine-internal ID. */
  readonly id: string;
  /** Display name in the requested language, exactly as the source data spells it. */
  readonly name: string;
  readonly coordinate: Coordinate;
  /** `key:value` classification of the place, e.g. `place:city`. */
  readonly category: string;
  readonly address: Readonly<Record<string, string>>;
  readonly kind?: PlaceKind;
  /** Extent of the place, when the data provides one, so a client can fit it on screen. */
  readonly bounds?: GeographicBounds;
}

/**
 * Attribution carried by every search answer.
 *
 * Search data derived from OpenStreetMap credits its contributors and names the licence. The
 * synthetic development fixture contains no OpenStreetMap data, so crediting it would itself be a
 * licensing error; it says plainly that it is not map data instead.
 */
export type PlaceAttribution =
  | {
      readonly licence: 'ODbL-1.0';
      readonly text: '© OpenStreetMap contributors';
      readonly url: 'https://www.openstreetmap.org/copyright';
    }
  | {
      readonly licence: 'none';
      readonly text: 'Synthetic development fixture — not map data';
      readonly url: null;
    };

/**
 * Outcome of a search or reverse geocoding request.
 *
 * Expected conditions are values rather than exceptions, so the transport mapping is total and
 * every branch is directly testable. Reverse geocoding uses the same envelope with at most one
 * result.
 */
export type PlaceQueryOutcome =
  | {
      readonly outcome: 'ok';
      readonly snapshotId: SnapshotId;
      readonly attribution: PlaceAttribution;
      readonly results: readonly PlaceResult[];
    }
  | {
      readonly outcome: 'invalid_request';
      readonly field: SearchRequestField;
      readonly reason: SearchInvalidReason;
    }
  | {
      readonly outcome: 'unavailable';
      readonly reason: SearchUnavailableReason;
      readonly retryable: boolean;
      /** Seconds a client should wait before retrying, when retrying can help. */
      readonly retryAfterSeconds: number | null;
    }
  | { readonly outcome: 'upstream_failed' };

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
  readonly hasSearch: boolean;
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
  search(request: SearchRequest): Promise<PlaceQueryOutcome>;
  reverseGeocode(request: ReverseGeocodeRequest): Promise<PlaceQueryOutcome>;
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
