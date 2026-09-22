import { FONTSTACK, archiveUrl, glyphUrlTemplate, spriteUrl } from './layout.js';

/**
 * Source layers this style draws. They are the OpenMapTiles-compatible layer names the tile
 * tooling emits; the provisioner asserts the built archive really contains them before a
 * snapshot may be activated, so the style never references a layer that does not exist.
 */
export const REQUIRED_SOURCE_LAYERS = [
  'water',
  'transportation',
  'building',
  'boundary',
  'place',
] as const;

export type SourceLayerName = (typeof REQUIRED_SOURCE_LAYERS)[number];

export const SOURCE_ID = 'basemap';

/** Language order for label text; the first tag that a feature carries wins. */
export function labelTextField(languages: readonly string[]): unknown {
  return ['coalesce', ...languages.map((language) => ['get', `name:${language}`]), ['get', 'name']];
}

export interface StyleInput {
  readonly attribution: string;
  readonly bounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly center: { readonly longitude: number; readonly latitude: number; readonly zoom: number };
  readonly labelLanguages: readonly string[];
  readonly maxZoom: number;
  readonly minZoom: number;
  readonly name: string;
  readonly snapshotId: string;
}

/**
 * Builds the basemap style document.
 *
 * Every URL is a same-origin, snapshot-versioned path — there is no sprite host, no glyph
 * service and no remote tile endpoint, so a browser renders the map with no external request.
 */
export function buildStyleDocument(input: StyleInput): Record<string, unknown> {
  const textField = labelTextField(input.labelLanguages);

  return {
    version: 8,
    name: input.name,
    metadata: {
      'atlas-os:snapshot': input.snapshotId,
      'atlas-os:labelLanguages': [...input.labelLanguages],
    },
    center: [input.center.longitude, input.center.latitude],
    zoom: input.center.zoom,
    bearing: 0,
    pitch: 0,
    glyphs: glyphUrlTemplate(input.snapshotId),
    sprite: spriteUrl(input.snapshotId),
    sources: {
      [SOURCE_ID]: {
        type: 'vector',
        // The `pmtiles://` scheme is resolved by the locally registered protocol handler, which
        // turns tile requests into byte-range reads against the same-origin archive URL.
        url: `pmtiles://${archiveUrl(input.snapshotId)}`,
        attribution: input.attribution,
        bounds: [input.bounds.west, input.bounds.south, input.bounds.east, input.bounds.north],
        minzoom: input.minZoom,
        maxzoom: input.maxZoom,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b1f18' },
      },
      {
        id: 'water',
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': 'water',
        paint: { 'fill-color': '#12384d', 'fill-opacity': 0.9 },
      },
      {
        id: 'building',
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': 'building',
        minzoom: 12,
        paint: { 'fill-color': '#1d3a30', 'fill-opacity': 0.65 },
      },
      {
        id: 'boundary',
        type: 'line',
        source: SOURCE_ID,
        'source-layer': 'boundary',
        paint: {
          'line-color': '#72e6b9',
          'line-opacity': 0.5,
          'line-dasharray': [3, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 10, 1.6],
        },
      },
      {
        id: 'transportation',
        type: 'line',
        source: SOURCE_ID,
        'source-layer': 'transportation',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#a7f3d0',
          'line-opacity': 0.75,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 10, 2, 16, 6],
        },
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: SOURCE_ID,
        'source-layer': 'place',
        layout: {
          'icon-image': 'place-dot',
          'icon-optional': true,
          'text-field': textField,
          'text-font': [FONTSTACK],
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 15],
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#e9f6f0',
          'text-halo-color': '#07130f',
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}

/** Source layers referenced by a style document, used to validate it against a built archive. */
export function styleSourceLayers(style: Record<string, unknown>): readonly string[] {
  const layers = style['layers'];
  if (!Array.isArray(layers)) return [];
  const names = new Set<string>();
  for (const layer of layers) {
    if (typeof layer !== 'object' || layer === null) continue;
    const sourceLayer = (layer as Record<string, unknown>)['source-layer'];
    if (typeof sourceLayer === 'string') names.add(sourceLayer);
  }
  return [...names].sort();
}

/**
 * True when a URL the renderer will fetch stays inside this deployment.
 *
 * Origin-relative paths are local by construction; the archive protocol wraps one. Anything with
 * a host is not.
 */
export function isLocalResourceUrl(url: string): boolean {
  if (url.startsWith('pmtiles:///')) return true;
  return url.startsWith('/') && !url.startsWith('//');
}

/**
 * URLs a renderer will actually fetch: the tile archive, glyphs and sprite.
 *
 * Attribution is deliberately excluded. Attribution is required to contain hyperlinks to the
 * projects whose data and schema the map uses, and those are navigational links a person may
 * click — they are never requested while rendering. Treating them as resource URLs would force a
 * choice between correct licensing and a meaningful offline guarantee.
 */
export function styleFetchedUrls(style: Record<string, unknown>): readonly string[] {
  const urls: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) urls.push(value);
  };

  push(style['glyphs']);
  push(style['sprite']);

  const sources = style['sources'];
  if (typeof sources === 'object' && sources !== null) {
    for (const source of Object.values(sources)) {
      if (typeof source !== 'object' || source === null) continue;
      const record = source as Record<string, unknown>;
      push(record['url']);
      const tiles = record['tiles'];
      if (Array.isArray(tiles)) for (const tile of tiles) push(tile);
    }
  }
  return urls;
}

/** Attribution strings a style declares, across its sources and its own metadata. */
export function styleAttributions(style: Record<string, unknown>): readonly string[] {
  const attributions: string[] = [];
  const sources = style['sources'];
  if (typeof sources === 'object' && sources !== null) {
    for (const source of Object.values(sources)) {
      if (typeof source !== 'object' || source === null) continue;
      const attribution = (source as Record<string, unknown>)['attribution'];
      if (typeof attribution === 'string' && attribution.length > 0) attributions.push(attribution);
    }
  }
  return attributions;
}

export function styleDeclaresAttribution(
  style: Record<string, unknown>,
  expected: string,
): boolean {
  return styleAttributions(style).includes(expected);
}
