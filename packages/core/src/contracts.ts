/**
 * Re-exported public domain contracts.
 *
 * Applications import these from core rather than from the platform package, so the dependency
 * direction `apps -> core -> atlas-os` holds for types as well as for behaviour.
 */
export type {
  AtlasOs,
  BasemapDescriptor,
  BasemapResourceHeaders,
  BasemapResourceReader,
  BasemapResourceRequest,
  BasemapResourceResult,
  BasemapUnavailableReason,
  Capabilities,
  CapabilityName,
  CapabilityState,
  Coordinate,
  DatasetInput,
  DatasetInputKind,
  DatasetInputProvenance,
  DatasetManager,
  DatasetStatus,
  GeographicBounds,
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
  TravelMode,
  UpdateCheckResult,
  ValidationReport,
} from '@atlas-os/platform';
