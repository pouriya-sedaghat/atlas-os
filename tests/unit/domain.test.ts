import {
  canTransitionDatasetStatus,
  createCoordinate,
  createSnapshotId,
  PlatformError,
  validateBounds,
} from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

describe('domain value validation', () => {
  it('accepts valid coordinates and geographic bounds', () => {
    expect(createCoordinate(51.389, 35.6892)).toEqual({ latitude: 35.6892, longitude: 51.389 });
    expect(validateBounds({ east: 63, north: 40, south: 24, west: 44 })).toEqual({
      east: 63,
      north: 40,
      south: 24,
      west: 44,
    });
  });

  it('rejects invalid coordinates, bounds, and snapshot IDs with typed errors', () => {
    expect(() => createCoordinate(181, 0)).toThrow(PlatformError);
    expect(() => validateBounds({ east: 44, north: 24, south: 40, west: 63 })).toThrow(
      PlatformError,
    );
    expect(() => createSnapshotId('NO')).toThrow(PlatformError);
  });
});

describe('dataset status transitions', () => {
  it('allows the blue/green preparation path and rejects impossible direct activation', () => {
    expect(canTransitionDatasetStatus('not_installed', 'updating')).toBe(true);
    expect(canTransitionDatasetStatus('updating', 'ready')).toBe(true);
    expect(canTransitionDatasetStatus('not_installed', 'ready')).toBe(false);
  });
});
