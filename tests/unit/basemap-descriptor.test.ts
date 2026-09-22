import { readFileSync } from 'node:fs';

import { parseSnapshotManifest } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

import {
  NOT_INSTALLED_BASEMAP,
  readyBasemapDescriptor,
  unavailableBasemap,
} from '../../packages/atlas-os/src/internal/basemap/descriptor.js';
import {
  REQUIRED_SOURCE_LAYERS,
  buildStyleDocument,
  isLocalResourceUrl,
  labelTextField,
  styleAttributions,
  styleDeclaresAttribution,
  styleFetchedUrls,
  styleSourceLayers,
} from '../../packages/atlas-os/src/internal/basemap/style.js';
import { TOOL_ATTRIBUTION } from '../../packages/atlas-os/src/internal/tools/planetiler.js';

function manifest(name: string) {
  return parseSnapshotManifest(
    JSON.parse(readFileSync(new URL(`../fixtures/snapshots/${name}`, import.meta.url), 'utf8')),
  );
}

describe('basemap descriptor construction', () => {
  it('derives every resource URL from the immutable snapshot identifier', () => {
    const descriptor = readyBasemapDescriptor(manifest('valid-basemap.json'));
    const id = 'iran-20260101t000000z-abcdef01';

    expect(descriptor).toEqual({
      attribution: 'Synthetic development fixture',
      availability: 'ready',
      bounds: { east: 63.333, north: 39.782, south: 24.397, west: 44.033 },
      glyphUrlTemplate: `/maps/v1/${id}/glyphs/{fontstack}/{range}.pbf`,
      labelLanguages: ['fa', 'en'],
      maxZoom: 13,
      mediaType: 'application/vnd.pmtiles',
      minZoom: 0,
      resourceUrl: `/maps/v1/${id}/basemap.pmtiles`,
      snapshotId: id,
      spriteUrl: `/maps/v1/${id}/sprite`,
      styleDescriptorUrl: `/maps/v1/${id}/style.json`,
      vectorFormat: 'mvt',
    });
  });

  it('exposes no descriptor for a snapshot without a basemap component', () => {
    expect(readyBasemapDescriptor(manifest('valid.json'))).toBeUndefined();
  });

  it('leaks no filesystem path or provider name', () => {
    const serialized = JSON.stringify(readyBasemapDescriptor(manifest('valid-basemap.json')));
    for (const provider of ['planetiler', 'maplibre', 'openmaptiles', 'maptiler', 'protomaps']) {
      expect(serialized.toLowerCase()).not.toContain(provider);
    }
    expect(serialized).not.toContain('/tmp');
    expect(serialized).not.toContain('/var/lib');
    expect(serialized).not.toContain('slots/');
  });

  it('describes the not-installed variant without any consumable resource', () => {
    expect(NOT_INSTALLED_BASEMAP).toEqual({
      availability: 'not_installed',
      reason: 'dataset_not_installed',
    });
  });

  it.each([
    'snapshot_missing',
    'snapshot_mismatch',
    'snapshot_corrupt',
    'region_mismatch',
    'basemap_missing',
  ] as const)('describes the unavailable reason %s without a consumable resource', (reason) => {
    const descriptor = unavailableBasemap(reason, 'Something is wrong.');

    expect(descriptor).toEqual({
      availability: 'unavailable',
      detail: 'Something is wrong.',
      reason,
    });
    for (const forbidden of [
      'snapshotId',
      'resourceUrl',
      'styleDescriptorUrl',
      'glyphUrlTemplate',
      'spriteUrl',
      'bounds',
      'minZoom',
      'maxZoom',
    ]) {
      expect(descriptor).not.toHaveProperty(forbidden);
    }
  });
});

describe('style document construction', () => {
  const style = buildStyleDocument({
    attribution: TOOL_ATTRIBUTION,
    bounds: { east: 63.333, north: 39.782, south: 24.397, west: 44.033 },
    center: { latitude: 35.6892, longitude: 51.389, zoom: 5 },
    labelLanguages: ['fa', 'en'],
    maxZoom: 13,
    minZoom: 0,
    name: 'fixture',
    snapshotId: 'iran-20260101t000000z-abcdef01',
  });

  it('draws every required source layer', () => {
    expect(styleSourceLayers(style)).toEqual([...REQUIRED_SOURCE_LAYERS].sort());
  });

  it('fetches only same-origin resources', () => {
    const fetched = styleFetchedUrls(style);
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(isLocalResourceUrl(url), `resource ${url} is not local`).toBe(true);
    }
    expect(style['glyphs']).toBe(
      '/maps/v1/iran-20260101t000000z-abcdef01/glyphs/{fontstack}/{range}.pbf',
    );
    expect(style['sprite']).toBe('/maps/v1/iran-20260101t000000z-abcdef01/sprite');
  });

  it('carries visible linked attribution for both required projects', () => {
    // The tile schema this basemap derives from requires credit for the schema project and for
    // the map data's contributors. These are navigational links a viewer may click; they are not
    // fetched while rendering, which is why they are not resource URLs.
    const attributions = styleAttributions(style);
    expect(attributions).toHaveLength(1);
    const attribution = attributions[0]!;

    expect(attribution).toContain('OpenMapTiles');
    expect(attribution).toContain('OpenStreetMap contributors');
    expect(attribution).toContain('href="https://www.openmaptiles.org/"');
    expect(attribution).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(styleDeclaresAttribution(style, TOOL_ATTRIBUTION)).toBe(true);
    expect(styleDeclaresAttribution(style, 'something else')).toBe(false);
  });

  it('does not treat an attribution hyperlink as a fetched resource', () => {
    // A blanket ban on every http(s) string in a style would make correct attribution
    // impossible, so the offline guarantee is expressed over fetched resources only.
    const attributionHosts = styleAttributions(style).join(' ');
    expect(attributionHosts).toMatch(/https:\/\//);
    expect(styleFetchedUrls(style).join(' ')).not.toMatch(/https?:\/\//);
  });

  it('orders label languages before the untagged name', () => {
    expect(labelTextField(['fa', 'en'])).toEqual([
      'coalesce',
      ['get', 'name:fa'],
      ['get', 'name:en'],
      ['get', 'name'],
    ]);
  });

  it.each([
    ['a hosted glyph service', { glyphs: 'https://fonts.example/{fontstack}/{range}.pbf' }],
    ['a hosted sprite', { sprite: 'https://sprites.example/basemap' }],
    [
      'a hosted tile source',
      {
        sources: { basemap: { tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'], type: 'vector' } },
      },
    ],
    [
      'a protocol-relative source',
      { sources: { basemap: { type: 'vector', url: '//tiles.example/a.pmtiles' } } },
    ],
  ])('detects %s as a non-local fetched resource', (_case, overrides) => {
    const reaching = { ...style, ...overrides };
    const external = styleFetchedUrls(reaching).filter((url) => !isLocalResourceUrl(url));
    expect(external.length).toBeGreaterThan(0);
  });
});
