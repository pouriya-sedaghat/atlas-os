import type {
  GeographicBounds,
  PlaceQueryOutcome,
  PlaceResult,
  ReverseGeocodeRequest,
  SearchComponentStatus,
  SearchRequest,
  SearchUnavailableReason,
  SnapshotId,
  StandbySnapshotStatus,
} from '../../contracts.js';
import type { ActivePointer, SearchComponent, SlotName, SnapshotManifest } from '../../snapshot.js';
import { searchComponentOf } from '../../snapshot.js';
import type { DatasetResolution } from '../basemap/availability.js';
import { resolveDataset } from '../basemap/availability.js';
import type { SnapshotStore } from '../snapshot/store.js';
import type { EngineHostClient, HostCallResult } from './client.js';
import type { HostLoad, HostStatus } from './protocol.js';
import { HOST_HEADERS } from './protocol.js';
import {
  placeResults,
  reverseHostParameters,
  searchHostParameters,
  withinBounds,
} from './queries.js';

/** Private URLs of the per-slot engine hosts this process may consult. */
export type SearchEngines = Readonly<Partial<Record<SlotName, URL>>>;

export interface SearchServiceOptions {
  readonly client: EngineHostClient;
  readonly engines: SearchEngines;
  readonly region: string;
  readonly store: SnapshotStore;
  /** Maximum concurrent engine requests before new ones are refused as `saturated`. */
  readonly concurrency?: number;
}

type Unavailable = Extract<PlaceQueryOutcome, { outcome: 'unavailable' }>;

const RETRY_AFTER_SECONDS: Readonly<Partial<Record<SearchUnavailableReason, number>>> = {
  dataset_changed: 1,
  generation_mismatch: 2,
  insufficient_space: 60,
  saturated: 1,
  starting: 5,
  timeout: 2,
};

const RETRYABLE: ReadonlySet<SearchUnavailableReason> = new Set([
  'dataset_changed',
  'dataset_unavailable',
  'generation_mismatch',
  'insufficient_space',
  'saturated',
  'starting',
  'timeout',
]);

function unavailable(reason: SearchUnavailableReason): Unavailable {
  const retryable = RETRYABLE.has(reason);
  return {
    outcome: 'unavailable',
    reason,
    retryable,
    retryAfterSeconds: retryable ? (RETRY_AFTER_SECONDS[reason] ?? 5) : null,
  };
}

function statusOf(outcome: Unavailable): SearchComponentStatus {
  return { reason: outcome.reason, retryable: outcome.retryable, state: 'unavailable' };
}

/** Every field of the pointer, so an activation, a rollback or an A->B->A flip is visible. */
function pointerKey(pointer: ActivePointer): string {
  return JSON.stringify([
    pointer.schemaVersion,
    pointer.snapshotId,
    pointer.slot,
    pointer.activatedAt,
    pointer.previous?.snapshotId ?? null,
    pointer.previous?.slot ?? null,
    pointer.previous?.activatedAt ?? null,
  ]);
}

function loadMatches(load: HostLoad | null, manifest: SnapshotManifest, search: SearchComponent) {
  return (
    load !== null &&
    load.snapshotId === manifest.snapshotId &&
    load.generationMarker === search.generationMarker &&
    load.engineImportDate === search.engine.importDate
  );
}

/** Why a host that is reachable is not serving the expected generation. */
function hostReason(status: HostStatus, manifest: SnapshotManifest): SearchUnavailableReason {
  const pending = status.pending;
  if (status.state === 'insufficient_space') return 'insufficient_space';
  if (pending?.state === 'insufficient_space') return 'insufficient_space';
  if (status.state === 'failed' || pending?.state === 'failed') return 'dataset_unavailable';
  if (status.load !== null && status.load.snapshotId === manifest.snapshotId) {
    return 'generation_mismatch';
  }
  return 'starting';
}

function callReason(
  result: Exclude<HostCallResult<unknown>, { kind: 'ok' }>,
): SearchUnavailableReason {
  switch (result.kind) {
    case 'timeout':
      return 'timeout';
    case 'unreachable':
    case 'unavailable':
      return 'starting';
    case 'failed':
      return 'dataset_unavailable';
  }
}

interface ActiveSearch {
  readonly pointer: ActivePointer;
  readonly manifest: SnapshotManifest;
  readonly search: SearchComponent;
  readonly bounds: GeographicBounds;
  readonly url: URL;
}

/**
 * Search availability and guarded queries.
 *
 * Availability is one resolution, shared by capabilities, dataset status, readiness and the query
 * routes. A query is answered only when the pointer, the manifest, the engine generation and the
 * engine's load identity agree before the query, in the answer itself, and again afterwards;
 * anything else fails closed with a typed, retryable outcome. Nothing here depends on elapsed
 * time: a restarted engine always has a new load identity, and any pointer change is visible.
 */
export class SearchService {
  readonly #client: EngineHostClient;
  readonly #concurrency: number;
  readonly #engines: SearchEngines;
  readonly #region: string;
  readonly #store: SnapshotStore;
  #inFlight = 0;

  constructor(options: SearchServiceOptions) {
    this.#client = options.client;
    this.#concurrency = options.concurrency ?? 32;
    this.#engines = options.engines;
    this.#region = options.region;
    this.#store = options.store;
  }

  /** Search availability for the active dataset described by `resolution`. */
  async activeStatus(resolution: DatasetResolution): Promise<SearchComponentStatus> {
    if (resolution.state === 'absent') return statusOf(unavailable('not_installed'));
    if (resolution.state === 'unavailable') return statusOf(unavailable('dataset_unavailable'));
    return this.#slotStatus(resolution.pointer.slot, resolution.manifest);
  }

  /** The snapshot prepared in the slot that is not serving, and whether its engine is ready. */
  async standby(resolution: DatasetResolution): Promise<StandbySnapshotStatus | null> {
    let slot: SlotName;
    if (resolution.state === 'ready') {
      slot = resolution.pointer.slot === 'blue' ? 'green' : 'blue';
    } else if (resolution.state === 'absent') {
      slot = 'blue';
    } else {
      return null;
    }
    const manifest = await this.#store.readManifest(slot).catch(() => undefined);
    if (manifest === undefined || manifest.region !== this.#region) return null;
    return {
      search: await this.#slotStatus(slot, manifest),
      snapshotId: manifest.snapshotId as SnapshotId,
    };
  }

  async search(request: SearchRequest): Promise<PlaceQueryOutcome> {
    return this.#guarded((active) => ({
      limit: request.limit,
      parameters: searchHostParameters(request, active.bounds),
      route: 'search',
    }));
  }

  async reverse(request: ReverseGeocodeRequest): Promise<PlaceQueryOutcome> {
    return this.#guarded((active) => {
      // Outside the snapshot's coverage there is nothing to find; the engine is not consulted.
      if (!withinBounds(active.bounds, request.coordinate)) return 'empty';
      return {
        limit: 1,
        parameters: reverseHostParameters(request.coordinate, request.language),
        route: 'reverse',
      };
    });
  }

  async #slotStatus(slot: SlotName, manifest: SnapshotManifest): Promise<SearchComponentStatus> {
    const search = searchComponentOf(manifest);
    if (search === undefined) return statusOf(unavailable('component_missing'));
    const url = this.#engines[slot];
    if (url === undefined) return statusOf(unavailable('not_installed'));
    const result = await this.#client.status(url);
    if (result.kind !== 'ok') return statusOf(unavailable(callReason(result)));
    const status = result.value;
    if (status.state === 'ready' && loadMatches(status.load, manifest, search)) {
      return { snapshotId: manifest.snapshotId as SnapshotId, state: 'ready' };
    }
    return statusOf(unavailable(hostReason(status, manifest)));
  }

  async #active(): Promise<ActiveSearch | Unavailable> {
    const resolution = await resolveDataset(this.#store, this.#region);
    if (resolution.state === 'absent') return unavailable('not_installed');
    if (resolution.state === 'unavailable') return unavailable('dataset_unavailable');
    const search = searchComponentOf(resolution.manifest);
    if (search === undefined) return unavailable('component_missing');
    const url = this.#engines[resolution.pointer.slot];
    if (url === undefined) return unavailable('not_installed');
    return {
      bounds: resolution.manifest.basemap!.bounds,
      manifest: resolution.manifest,
      pointer: resolution.pointer,
      search,
      url,
    };
  }

  async #guarded(
    plan: (active: ActiveSearch) =>
      | 'empty'
      | {
          readonly route: 'search' | 'reverse';
          readonly parameters: Readonly<Record<string, string>>;
          readonly limit: number;
        },
  ): Promise<PlaceQueryOutcome> {
    if (this.#inFlight >= this.#concurrency) return unavailable('saturated');
    this.#inFlight += 1;
    try {
      const before = await this.#active();
      if ('outcome' in before) return before;
      const { manifest, search, url } = before;

      const request = plan(before);
      if (request === 'empty') {
        return this.#answer(before, []);
      }

      // Before: the engine for the active slot serves exactly the active generation.
      const statusBefore = await this.#client.status(url);
      if (statusBefore.kind !== 'ok') return unavailable(callReason(statusBefore));
      const load = statusBefore.value.load;
      if (statusBefore.value.state !== 'ready' || !loadMatches(load, manifest, search)) {
        return unavailable(hostReason(statusBefore.value, manifest));
      }

      // During: the answer itself names the load and generation that produced it.
      const answer = await this.#client.query(url, request.route, request.parameters);
      if (answer.kind === 'failed') return { outcome: 'upstream_failed' };
      if (answer.kind !== 'ok') return unavailable(callReason(answer));
      if (
        answer.headers[HOST_HEADERS.loadId] !== load!.loadId ||
        answer.headers[HOST_HEADERS.generation] !== search.generationMarker ||
        answer.headers[HOST_HEADERS.snapshotId] !== manifest.snapshotId
      ) {
        return unavailable('generation_mismatch');
      }

      // After: the same load is still answering, and the pointer and manifest have not moved.
      const statusAfter = await this.#client.status(url);
      if (statusAfter.kind !== 'ok') return unavailable(callReason(statusAfter));
      if (statusAfter.value.load?.loadId !== load!.loadId)
        return unavailable('generation_mismatch');
      const after = await this.#active();
      if ('outcome' in after) return unavailable('dataset_changed');
      if (
        pointerKey(after.pointer) !== pointerKey(before.pointer) ||
        after.manifest.snapshotId !== manifest.snapshotId ||
        after.search.generationMarker !== search.generationMarker
      ) {
        return unavailable('dataset_changed');
      }

      return this.#answer(before, placeResults(answer.value, before.bounds, request.limit));
    } finally {
      this.#inFlight -= 1;
    }
  }

  #answer(active: ActiveSearch, results: readonly PlaceResult[]): PlaceQueryOutcome {
    return {
      attribution: active.search.attribution,
      outcome: 'ok',
      results,
      snapshotId: active.manifest.snapshotId as SnapshotId,
    };
  }
}
