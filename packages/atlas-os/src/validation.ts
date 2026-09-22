import type { Coordinate, DatasetStatus, GeographicBounds, SnapshotId } from './contracts.js';
import { PlatformError } from './errors.js';

const snapshotIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export function createSnapshotId(value: string): SnapshotId {
  if (!snapshotIdPattern.test(value)) {
    throw new PlatformError(
      'VALIDATION_FAILED',
      'Snapshot IDs must be 3-64 lowercase URL-safe characters.',
      { details: { field: 'snapshotId' } },
    );
  }
  return value as SnapshotId;
}

export function createCoordinate(longitude: number, latitude: number): Coordinate {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new PlatformError('VALIDATION_FAILED', 'Longitude must be between -180 and 180.', {
      details: { field: 'longitude' },
    });
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new PlatformError('VALIDATION_FAILED', 'Latitude must be between -90 and 90.', {
      details: { field: 'latitude' },
    });
  }
  return { latitude, longitude };
}

export function validateBounds(bounds: GeographicBounds): GeographicBounds {
  createCoordinate(bounds.west, bounds.south);
  createCoordinate(bounds.east, bounds.north);
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new PlatformError('VALIDATION_FAILED', 'Bounds must have increasing axes.', {
      details: { field: 'bounds' },
    });
  }
  return bounds;
}

const transitions: Readonly<Record<DatasetStatus['state'], readonly DatasetStatus['state'][]>> = {
  not_installed: ['updating'],
  updating: ['ready', 'degraded'],
  ready: ['updating', 'degraded'],
  degraded: ['updating', 'ready'],
};

export function canTransitionDatasetStatus(
  from: DatasetStatus['state'],
  to: DatasetStatus['state'],
): boolean {
  return from === to || transitions[from].includes(to);
}
