import type { BasemapDescriptor, Capabilities, DatasetStatus } from '@atlas-os/core';

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
