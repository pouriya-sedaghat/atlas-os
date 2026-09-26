import type { OsmData, OsmNode, OsmRelation, OsmWay, Tags } from './osm-pbf.js';

/**
 * A tiny, entirely synthetic OpenStreetMap dataset placed inside Iran's bounds.
 *
 * It exists to drive the production search pipeline end to end on something small: two provinces
 * and two cities as administrative boundaries, one street split into two ways, the same street
 * name in a second city, house numbers in ASCII and Persian digits with a postcode, and names that
 * exercise Arabic letter variants and ZWNJ. Identifiers and geometry are invented; this is not a
 * map of any territory.
 */

const ZWNJ = String.fromCodePoint(0x200c);
const ARABIC_KAF = String.fromCodePoint(0x0643);
const ARABIC_YEH = String.fromCodePoint(0x064a);

/** 2026-09-01T00:00:00Z. */
export const TINY_OSM_TIMESTAMP = 1_788_220_800;

function names(fa: string, en: string): Tags {
  return { name: fa, 'name:en': en, 'name:fa': fa };
}

function ring(
  firstNodeId: number,
  south: number,
  west: number,
  north: number,
  east: number,
): { readonly nodes: OsmNode[]; readonly refs: number[] } {
  const corners = [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ] as const;
  const nodes = corners.map(([lat, lon], index) => ({ id: firstNodeId + index, lat, lon }));
  return { nodes, refs: [...nodes.map((node) => node.id), firstNodeId] };
}

function boundary(
  relationId: number,
  wayId: number,
  refs: readonly number[],
  level: number,
  tags: Tags,
  label?: number,
): { readonly relation: OsmRelation; readonly way: OsmWay } {
  return {
    relation: {
      id: relationId,
      members: [
        { ref: wayId, role: 'outer', type: 'way' },
        ...(label === undefined ? [] : [{ ref: label, role: 'label', type: 'node' as const }]),
      ],
      tags: { ...tags, admin_level: String(level), boundary: 'administrative', type: 'boundary' },
    },
    way: { id: wayId, refs },
  };
}

/** Stable public identifiers the pipeline test expects to find again after the whole pipeline. */
export const TINY_OSM_IDS = {
  azadiShiraz: 'osm:way:3101',
  azadiTehranEast: 'osm:way:3002',
  azadiTehranWest: 'osm:way:3001',
  bookshop: 'osm:node:602',
  house12: 'osm:node:401',
  house45: 'osm:node:402',
  library: 'osm:node:601',
  milad: 'osm:way:4001',
  shiraz: 'osm:relation:9004',
  tehran: 'osm:relation:9002',
} as const;

export function tinyOsmData(): OsmData {
  const tehranProvince = ring(101, 35.4, 51.0, 36.0, 51.8);
  const tehranCity = ring(111, 35.55, 51.2, 35.85, 51.6);
  const farsProvince = ring(201, 29.0, 52.0, 30.2, 53.2);
  const shirazCity = ring(211, 29.5, 52.4, 29.72, 52.65);
  const milad = ring(501, 35.7443, 51.3748, 35.7453, 51.3758);
  const park = ring(511, 35.668, 51.418, 35.672, 51.422);

  const boundaries = [
    boundary(9001, 1001, tehranProvince.refs, 4, names('استان تهران', 'Tehran Province')),
    boundary(9002, 1011, tehranCity.refs, 8, names('تهران', 'Tehran'), 120),
    boundary(9003, 1021, farsProvince.refs, 4, names('استان فارس', 'Fars Province')),
    boundary(9004, 1031, shirazCity.refs, 8, names('شیراز', 'Shiraz'), 220),
  ];

  const azadi = { ...names('خیابان آزادی', 'Azadi Street'), highway: 'primary' };
  const nodes: OsmNode[] = [
    ...tehranProvince.nodes,
    ...tehranCity.nodes,
    ...farsProvince.nodes,
    ...shirazCity.nodes,
    ...milad.nodes,
    ...park.nodes,
    { id: 120, lat: 35.6892, lon: 51.389, tags: { ...names('تهران', 'Tehran'), place: 'city' } },
    { id: 220, lat: 29.5918, lon: 52.5311, tags: { ...names('شیراز', 'Shiraz'), place: 'city' } },
    { id: 301, lat: 35.7, lon: 51.34 },
    { id: 302, lat: 35.7, lon: 51.37 },
    { id: 303, lat: 35.7, lon: 51.4 },
    { id: 311, lat: 29.61, lon: 52.52 },
    { id: 312, lat: 29.61, lon: 52.56 },
    {
      id: 401,
      lat: 35.7002,
      lon: 51.3605,
      tags: {
        'addr:housenumber': '12',
        'addr:postcode': '1458889694',
        'addr:street': 'خیابان آزادی',
      },
    },
    {
      id: 402,
      lat: 35.7003,
      lon: 51.362,
      tags: { 'addr:housenumber': '۴۵', 'addr:street': 'خیابان آزادی' },
    },
    {
      id: 601,
      lat: 35.71,
      lon: 51.41,
      tags: {
        amenity: 'library',
        name: `${ARABIC_KAF}تابخانه مل${ARABIC_YEH}`,
        'name:en': 'National Library (fixture)',
      },
    },
    {
      id: 602,
      lat: 35.701,
      lon: 51.389,
      tags: {
        ...names(`کتاب${ZWNJ}فروشی ققنوس`, 'Ghoghnoos Bookshop (fixture)'),
        shop: 'books',
      },
    },
  ];

  const ways: OsmWay[] = [
    ...boundaries.map((entry) => entry.way),
    { id: 3001, refs: [301, 302], tags: azadi },
    { id: 3002, refs: [302, 303], tags: azadi },
    { id: 3101, refs: [311, 312], tags: azadi },
    {
      id: 4001,
      refs: milad.refs,
      tags: {
        ...names('برج میلاد', 'Milad Tower'),
        man_made: 'tower',
        'tower:type': 'communication',
        tourism: 'attraction',
      },
    },
    {
      id: 4002,
      refs: park.refs,
      tags: { ...names('پارک ۱۵ خرداد', '15 Khordad Park'), leisure: 'park' },
    },
  ];

  return {
    nodes,
    relations: boundaries.map((entry) => entry.relation),
    timestamp: TINY_OSM_TIMESTAMP,
    ways,
  };
}
