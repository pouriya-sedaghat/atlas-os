import type { BasemapUnavailableReason } from '../../contracts.js';
import type { SnapshotManifest } from '../../snapshot.js';
import { parseSnapshotManifest } from '../../snapshot.js';
import type { SnapshotStore } from '../snapshot/store.js';

/**
 * The single resolution of "what, if anything, is this host serving?".
 *
 * `datasetStatus`, `capabilities` and `basemap` are all derived from this one value, so the three
 * surfaces cannot disagree with one another.
 */
export type DatasetResolution =
  | { readonly state: 'absent' }
  | {
      readonly state: 'unavailable';
      readonly reason: BasemapUnavailableReason;
      readonly detail: string;
      readonly snapshotId: string | null;
    }
  | {
      readonly state: 'ready';
      readonly activatedAt: string;
      readonly manifest: SnapshotManifest;
    };

export async function resolveDataset(
  store: SnapshotStore,
  region: string,
): Promise<DatasetResolution> {
  let pointer;
  try {
    pointer = await store.readActivePointer();
  } catch (error) {
    return {
      detail: describe(error, 'The active snapshot pointer could not be read.'),
      reason: 'snapshot_corrupt',
      snapshotId: null,
      state: 'unavailable',
    };
  }
  if (pointer === undefined) return { state: 'absent' };

  let manifest: SnapshotManifest | undefined;
  try {
    manifest = await store.readManifest(pointer.slot);
  } catch (error) {
    return {
      detail: describe(error, 'The active snapshot manifest could not be read.'),
      reason: 'snapshot_corrupt',
      snapshotId: pointer.snapshotId,
      state: 'unavailable',
    };
  }

  if (manifest === undefined) {
    return {
      detail: 'The active snapshot pointer names a snapshot that is not stored.',
      reason: 'snapshot_missing',
      snapshotId: pointer.snapshotId,
      state: 'unavailable',
    };
  }
  if (manifest.snapshotId !== pointer.snapshotId) {
    return {
      detail: 'The stored snapshot does not match the active snapshot pointer.',
      reason: 'snapshot_mismatch',
      snapshotId: pointer.snapshotId,
      state: 'unavailable',
    };
  }
  if (manifest.region !== region) {
    return {
      detail: `The active snapshot covers ${manifest.region}, not ${region}.`,
      reason: 'region_mismatch',
      snapshotId: manifest.snapshotId,
      state: 'unavailable',
    };
  }
  if (manifest.basemap === undefined) {
    return {
      detail: 'The active snapshot carries no basemap component.',
      reason: 'basemap_missing',
      snapshotId: manifest.snapshotId,
      state: 'unavailable',
    };
  }

  return { activatedAt: pointer.activatedAt, manifest, state: 'ready' };
}

function describe(error: unknown, fallback: string): string {
  // Only the platform's own validation messages are surfaced; an unexpected failure is reported
  // generically so no filesystem path reaches a response.
  if (error instanceof Error && error.name === 'PlatformError') return error.message;
  return fallback;
}

export { parseSnapshotManifest };
