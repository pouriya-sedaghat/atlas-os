import type { Feature, FeatureCollection, Position } from 'geojson';

/**
 * A small, entirely synthetic feature set used to exercise the basemap pipeline without any
 * OpenStreetMap download.
 *
 * The geometry is invented and deliberately coarse: it is a test scaffold, not a map of Iran.
 * What matters is that it produces the same OpenMapTiles-compatible source layers, attribute
 * names and label languages that the production tile tooling produces, so the archive format,
 * style, glyph coverage and renderer path are all exercised for real.
 */

function polygon(
  id: string,
  ring: readonly Position[],
  properties: Record<string, unknown>,
): Feature {
  return {
    geometry: { coordinates: [[...ring, ring[0]!]], type: 'Polygon' },
    id,
    properties,
    type: 'Feature',
  };
}

function line(
  id: string,
  coordinates: readonly Position[],
  properties: Record<string, unknown>,
): Feature {
  return {
    geometry: { coordinates: [...coordinates], type: 'LineString' },
    id,
    properties,
    type: 'Feature',
  };
}

function point(
  id: string,
  coordinates: Position,
  names: { readonly fa: string; readonly en: string },
  properties: Record<string, unknown>,
): Feature {
  return {
    geometry: { coordinates, type: 'Point' },
    id,
    properties: {
      ...properties,
      name: names.en,
      'name:en': names.en,
      'name:fa': names.fa,
    },
    type: 'Feature',
  };
}

function collection(features: readonly Feature[]): FeatureCollection {
  return { features: [...features], type: 'FeatureCollection' };
}

/** Region-wide overview coverage. */
export const FIXTURE_REGION_BOUNDS = {
  east: 63.333,
  north: 39.782,
  south: 24.397,
  west: 44.033,
} as const;

/** A small detailed area so high-zoom layers such as buildings have something to draw. */
export const FIXTURE_DETAIL_BOUNDS = {
  east: 51.46,
  north: 35.73,
  south: 35.66,
  west: 51.36,
} as const;

export const FIXTURE_CENTER = { latitude: 35.6892, longitude: 51.389, zoom: 5 } as const;

export function fixtureWaterLayer(): FeatureCollection {
  return collection([
    // Stand-ins for the Caspian Sea and the Persian Gulf, as simple quadrilaterals.
    polygon(
      'water-north',
      [
        [48.6, 36.7],
        [54.0, 36.6],
        [54.0, 39.6],
        [48.6, 39.0],
      ],
      { class: 'lake' },
    ),
    polygon(
      'water-south',
      [
        [48.3, 29.9],
        [56.4, 26.0],
        [57.2, 25.0],
        [48.0, 28.9],
      ],
      { class: 'ocean' },
    ),
    polygon(
      'water-detail',
      [
        [51.4, 35.69],
        [51.42, 35.69],
        [51.42, 35.7],
        [51.4, 35.7],
      ],
      { class: 'lake' },
    ),
  ]);
}

export function fixtureTransportationLayer(): FeatureCollection {
  return collection([
    line(
      'road-north-south',
      [
        [51.42, 38.4],
        [51.39, 35.69],
        [52.53, 29.6],
        [56.27, 27.19],
      ],
      { class: 'motorway' },
    ),
    line(
      'road-east-west',
      [
        [46.29, 38.08],
        [51.39, 35.69],
        [59.61, 36.31],
      ],
      { class: 'trunk' },
    ),
    line(
      'road-south-west',
      [
        [48.68, 34.8],
        [52.53, 29.6],
      ],
      { class: 'primary' },
    ),
    line(
      'road-detail',
      [
        [51.37, 35.67],
        [51.45, 35.72],
      ],
      { class: 'secondary' },
    ),
  ]);
}

export function fixtureBuildingLayer(): FeatureCollection {
  const features: Feature[] = [];
  // A deterministic grid of small footprints inside the detail area.
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const west = 51.38 + column * 0.004;
      const south = 35.68 + row * 0.004;
      features.push(
        polygon(
          `building-${row}-${column}`,
          [
            [west, south],
            [west + 0.0022, south],
            [west + 0.0022, south + 0.0022],
            [west, south + 0.0022],
          ],
          { render_height: 12 + row * 3 },
        ),
      );
    }
  }
  return collection(features);
}

export function fixtureBoundaryLayer(): FeatureCollection {
  const { west, south, east, north } = FIXTURE_REGION_BOUNDS;
  return collection([
    line(
      'boundary-region',
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
      { admin_level: 2, maritime: 0 },
    ),
  ]);
}

export function fixturePlaceLayer(): FeatureCollection {
  return collection([
    point(
      'place-capital',
      [51.389, 35.6892],
      { en: 'Tehran', fa: 'تهران' },
      {
        class: 'city',
        rank: 1,
      },
    ),
    point(
      'place-mashhad',
      [59.606, 36.297],
      { en: 'Mashhad', fa: 'مشهد' },
      {
        class: 'city',
        rank: 2,
      },
    ),
    point(
      'place-isfahan',
      [51.667, 32.6546],
      { en: 'Isfahan', fa: 'اصفهان' },
      {
        class: 'city',
        rank: 2,
      },
    ),
    point(
      'place-shiraz',
      [52.5319, 29.5918],
      { en: 'Shiraz', fa: 'شیراز' },
      {
        class: 'city',
        rank: 3,
      },
    ),
    point(
      'place-tabriz',
      [46.2919, 38.0792],
      { en: 'Tabriz', fa: 'تبریز' },
      {
        class: 'city',
        rank: 3,
      },
    ),
    point(
      'place-bandar-abbas',
      [56.2666, 27.1832],
      { en: 'Bandar Abbas', fa: 'بندرعباس' },
      {
        class: 'town',
        rank: 4,
      },
    ),
    point(
      'place-detail',
      [51.41, 35.7],
      { en: 'District', fa: 'منطقه' },
      {
        class: 'suburb',
        rank: 6,
      },
    ),
  ]);
}
