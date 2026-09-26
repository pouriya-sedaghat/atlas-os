import { writeFile } from 'node:fs/promises';

import { sha256Bytes } from '../../fs/checksum.js';
import { serializeDumpRow } from './postprocess.js';

/**
 * The synthetic development search fixture.
 *
 * It is written in exactly the shape the production database export produces, so it runs
 * through the same post-processing, import, sealing, validation and serving as a real region.
 * Everything in it is invented. Identifiers sit in a reserved range far above any real
 * OpenStreetMap identifier, and the attribution says plainly that it is not map data.
 */

/** 2026-01-01T00:00:00.000Z, fixed so the fixture's bytes, and so its checksum, never change. */
export const SYNTHETIC_DATA_TIMESTAMP = '2026-01-01T00:00:00.000+00:00';

/** Reserved identifier base: well inside the safe integer range, far above real object IDs. */
export const SYNTHETIC_ID_BASE = 8_000_000_000_000_000;

const ARABIC_KAF = String.fromCodePoint(0x0643);
const ARABIC_YEH = String.fromCodePoint(0x064a);
const PERSIAN_DIGIT_ONE = String.fromCodePoint(0x06f1);
const PERSIAN_DIGIT_TWO = String.fromCodePoint(0x06f2);

interface SyntheticPlace {
  readonly offset: number;
  readonly objectType: 'N' | 'W';
  readonly key: string;
  readonly value: string;
  readonly addressType: string;
  readonly coordinate: readonly [number, number];
  readonly importance: number;
  readonly names?: { readonly fa: string; readonly en: string };
  readonly housenumber?: string;
  readonly address?: Readonly<Record<string, string>>;
}

const TEHRAN_ADDRESS = {
  city: 'تهران',
  'city:en': 'Tehran',
  'city:fa': 'تهران',
} as const;

const STREET_ADDRESS = {
  ...TEHRAN_ADDRESS,
  street: 'خیابان آزادی',
  'street:en': 'Azadi Street',
  'street:fa': 'خیابان آزادی',
} as const;

function city(
  offset: number,
  coordinate: readonly [number, number],
  fa: string,
  en: string,
  importance: number,
  value = 'city',
): SyntheticPlace {
  return {
    addressType: 'city',
    coordinate,
    importance,
    key: 'place',
    names: { en, fa },
    objectType: 'N',
    offset,
    value,
  };
}

/** The places of the synthetic basemap fixture, plus a street, a house and a named point. */
export const SYNTHETIC_PLACES: readonly SyntheticPlace[] = [
  city(1, [51.389, 35.6892], 'تهران', 'Tehran', 0.8),
  city(2, [59.606, 36.297], 'مشهد', 'Mashhad', 0.6),
  city(3, [51.667, 32.6546], 'اصفهان', 'Isfahan', 0.6),
  city(4, [52.5319, 29.5918], 'شیراز', 'Shiraz', 0.5),
  city(5, [46.2919, 38.0792], 'تبریز', 'Tabriz', 0.5),
  city(6, [56.2666, 27.1832], 'بندرعباس', 'Bandar Abbas', 0.4, 'town'),
  {
    address: TEHRAN_ADDRESS,
    addressType: 'district',
    coordinate: [51.41, 35.7],
    importance: 0.2,
    key: 'place',
    names: { en: 'District', fa: 'منطقه' },
    objectType: 'N',
    offset: 7,
    value: 'suburb',
  },
  {
    address: TEHRAN_ADDRESS,
    addressType: 'street',
    coordinate: [51.37, 35.7],
    importance: 0.1,
    key: 'highway',
    names: { en: 'Azadi Street', fa: 'خیابان آزادی' },
    objectType: 'W',
    offset: 8,
    value: 'primary',
  },
  {
    address: STREET_ADDRESS,
    addressType: 'house',
    coordinate: [51.3605, 35.7002],
    housenumber: `${PERSIAN_DIGIT_ONE}${PERSIAN_DIGIT_TWO}`,
    importance: 0.00001,
    key: 'place',
    objectType: 'N',
    offset: 9,
    value: 'house',
  },
  {
    address: STREET_ADDRESS,
    addressType: 'house',
    coordinate: [51.41, 35.71],
    importance: 0.00001,
    key: 'amenity',
    names: { en: 'National Library (synthetic)', fa: `${ARABIC_KAF}تابخانه مل${ARABIC_YEH}` },
    objectType: 'N',
    offset: 10,
    value: 'library',
  },
];

/** The stable public identifier of a synthetic place. */
export function syntheticPlaceId(offset: number): string {
  const place = SYNTHETIC_PLACES.find((entry) => entry.offset === offset);
  if (place === undefined) throw new Error(`No synthetic place at offset ${offset}.`);
  return `osm:${place.objectType === 'N' ? 'node' : 'way'}:${SYNTHETIC_ID_BASE + offset}`;
}

function placeRow(place: SyntheticPlace): string {
  const [longitude, latitude] = place.coordinate;
  return serializeDumpRow('Place', [
    {
      place_id: String(place.offset),
      object_type: place.objectType,
      object_id: SYNTHETIC_ID_BASE + place.offset,
      osm_key: place.key,
      osm_value: place.value,
      categories: [`osm.${place.key}.${place.value}`],
      address_type: place.addressType,
      importance: place.importance,
      ...(place.names === undefined
        ? {}
        : {
            name: {
              name: place.names.fa,
              'name:en': place.names.en,
              'name:fa': place.names.fa,
            },
          }),
      ...(place.housenumber === undefined ? {} : { housenumber: place.housenumber }),
      ...(place.address === undefined ? {} : { address: place.address }),
      country_code: 'ir',
      centroid: [longitude, latitude],
      bbox: [longitude, latitude, longitude, latitude],
    },
  ]);
}

/** The complete synthetic database export, byte for byte. */
export function syntheticDump(): string {
  return [
    serializeDumpRow('NominatimDumpFile', {
      version: '0.1.0',
      generator: 'atlas-os-synthetic',
      database_version: '1.0.0-4',
      data_timestamp: SYNTHETIC_DATA_TIMESTAMP,
      features: { sorted_by_country: true, has_addresslines: false },
    }),
    serializeDumpRow('CountryInfo', [
      { country_code: 'ir', name: { name: 'ایران', 'name:en': 'Iran', 'name:fa': 'ایران' } },
    ]),
    ...SYNTHETIC_PLACES.map(placeRow),
  ].join('');
}

/** Writes the synthetic export and returns the checksum that identifies it as the source. */
export async function writeSyntheticDump(
  path: string,
): Promise<{ readonly checksum: string; readonly bytes: number }> {
  const bytes = Buffer.from(syntheticDump(), 'utf8');
  await writeFile(path, bytes, { flag: 'wx' });
  return { bytes: bytes.length, checksum: sha256Bytes(bytes) };
}
