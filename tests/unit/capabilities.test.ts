import { m0Capabilities } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

describe('capability representation', () => {
  it('declares every M0 geospatial feature as not installed', () => {
    expect(Object.keys(m0Capabilities.features).sort()).toEqual([
      'basemap',
      'isochrones',
      'map_matching',
      'matrix',
      'reverse_geocoding',
      'routing',
      'search',
    ]);
    expect(Object.values(m0Capabilities.features)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ available: false, reason: 'not_installed' }),
      ]),
    );
  });
});
