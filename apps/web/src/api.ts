import type {
  BasemapDescriptor,
  Capabilities,
  DatasetStatus,
  PlaceAttribution,
  PlaceResult,
  SearchLanguage,
} from '@atlas-os/core';

/**
 * Every response the browser consumes comes from the local API through the same-origin gateway.
 * The application never contacts another origin, and it learns about the basemap only through
 * these contracts — never by guessing a resource URL.
 */
const API_PREFIX = '/api';

export interface HealthResponse {
  readonly status: string;
  readonly service: string;
  readonly requestId: string;
}

export interface ReadinessResponse {
  readonly ready: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly status: string;
    readonly message: string;
  }[];
  readonly requestId: string;
}

async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Local API returned HTTP ${response.status} for ${path}.`);
  return (await response.json()) as T;
}

export interface PlatformSnapshot {
  readonly basemap: BasemapDescriptor;
  readonly capabilities: Capabilities;
  readonly dataset: DatasetStatus;
  readonly health: HealthResponse;
  readonly readiness: ReadinessResponse;
}

export async function readPlatformSnapshot(signal: AbortSignal): Promise<PlatformSnapshot> {
  const [health, readiness, dataset, capabilities, basemap] = await Promise.all([
    readJson<HealthResponse>('/health', signal),
    readJson<ReadinessResponse>('/ready', signal),
    readJson<DatasetStatus>('/v1/dataset', signal),
    readJson<Capabilities>('/v1/capabilities', signal),
    readJson<BasemapDescriptor>('/v1/basemap', signal),
  ]);
  return { basemap, capabilities, dataset, health, readiness };
}

/** A place query answered by the local API, reduced to what the interface needs. */
export type PlaceAnswer =
  | {
      readonly kind: 'ok';
      readonly snapshotId: string;
      readonly attribution: PlaceAttribution;
      readonly results: readonly PlaceResult[];
    }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: boolean }
  | { readonly kind: 'failed' };

async function readPlaces(path: string, signal: AbortSignal): Promise<PlaceAnswer> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal,
  });
  if (response.status === 400) return { kind: 'invalid' };
  if (response.status === 503) {
    const body = (await response.json().catch(() => null)) as {
      error?: { details?: { reason?: unknown; retryable?: unknown } };
    } | null;
    const details = body?.error?.details;
    return {
      kind: 'unavailable',
      reason: typeof details?.reason === 'string' ? details.reason : 'unknown',
      retryable: details?.retryable === true,
    };
  }
  if (!response.ok) return { kind: 'failed' };
  const body = (await response.json()) as {
    snapshotId: string;
    attribution: PlaceAttribution;
    results: readonly PlaceResult[];
  };
  return {
    attribution: body.attribution,
    kind: 'ok',
    results: body.results,
    snapshotId: body.snapshotId,
  };
}

export function searchPlaces(
  query: string,
  language: SearchLanguage,
  signal: AbortSignal,
): Promise<PlaceAnswer> {
  const parameters = new URLSearchParams({ language, limit: '8', q: query });
  return readPlaces(`/v1/search?${parameters.toString()}`, signal);
}

export function describePoint(
  coordinate: { readonly latitude: number; readonly longitude: number },
  language: SearchLanguage,
  signal: AbortSignal,
): Promise<PlaceAnswer> {
  const parameters = new URLSearchParams({
    language,
    lat: coordinate.latitude.toFixed(6),
    lon: coordinate.longitude.toFixed(6),
  });
  return readPlaces(`/v1/reverse?${parameters.toString()}`, signal);
}
