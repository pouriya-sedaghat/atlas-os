import { z } from 'zod';

import type { GeographicBounds, PlaceKind, PlaceResult } from '../../contracts.js';

/**
 * The complete response shape the pinned engine returns for forward and reverse queries.
 *
 * Validated in full: an unexpected field or type is treated as an upstream failure rather than
 * passed through, so nothing the engine emits reaches a client without being understood first.
 */
const text = z.string().max(1024);

const engineFeatureSchema = z
  .object({
    geometry: z
      .object({
        coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
        type: z.literal('Point'),
      })
      .strict(),
    properties: z
      .object({
        city: text.optional(),
        country: text.optional(),
        countrycode: z.string().max(8).optional(),
        county: text.optional(),
        district: text.optional(),
        extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        extra: z.record(z.string().max(64), text).optional(),
        housenumber: text.optional(),
        locality: text.optional(),
        name: text.optional(),
        osm_id: z.number().int().optional(),
        osm_key: z.string().max(256).optional(),
        osm_type: z.string().max(8).optional(),
        osm_value: z.string().max(256).optional(),
        postcode: text.optional(),
        state: text.optional(),
        street: text.optional(),
        type: z.string().max(32).optional(),
      })
      .strict(),
    type: z.literal('Feature'),
  })
  .strict();

export const engineCollectionSchema = z
  .object({
    features: z.array(engineFeatureSchema).max(64),
    type: z.literal('FeatureCollection'),
  })
  .strict();

export type EngineCollection = z.infer<typeof engineCollectionSchema>;
type EngineFeature = z.infer<typeof engineFeatureSchema>;

/** Private extra keys the import writes to keep original spellings of canonicalised values. */
export const ORIGINAL_HOUSENUMBER_KEY = 'atlas_housenumber';
export const ORIGINAL_POSTCODE_KEY = 'atlas_postcode';
export const GENERATION_KEY = 'atlas_generation';

/** The generation canary's identity: an object type no OpenStreetMap object can have. */
export const CANARY_OBJECT_TYPE = 'X';
export const CANARY_OBJECT_ID = 0;

const OSM_TYPES: Readonly<Record<string, string>> = { N: 'node', R: 'relation', W: 'way' };
const KINDS: ReadonlySet<string> = new Set<PlaceKind>([
  'house',
  'street',
  'locality',
  'district',
  'city',
  'county',
  'state',
  'country',
  'other',
]);

export interface MappingContext {
  /** Only results inside these bounds are returned; the canary lies far outside them. */
  readonly bounds: GeographicBounds;
}

function within(bounds: GeographicBounds, longitude: number, latitude: number): boolean {
  return (
    longitude >= bounds.west &&
    longitude <= bounds.east &&
    latitude >= bounds.south &&
    latitude <= bounds.north
  );
}

export function isCanary(feature: EngineFeature): boolean {
  return (
    feature.properties.osm_type === CANARY_OBJECT_TYPE &&
    feature.properties.osm_id === CANARY_OBJECT_ID
  );
}

/** Stable public identifier, or `undefined` for anything that is not an OpenStreetMap object. */
export function placeId(
  osmType: string | undefined,
  osmId: number | undefined,
): string | undefined {
  if (osmType === undefined || osmId === undefined) return undefined;
  const type = OSM_TYPES[osmType];
  if (type === undefined || !Number.isSafeInteger(osmId) || osmId <= 0) return undefined;
  return `osm:${type}:${osmId}`;
}

function extentBounds(extent: readonly [number, number, number, number] | undefined) {
  if (extent === undefined) return undefined;
  // The engine writes extents as [minLon, maxLat, maxLon, minLat].
  const [west, north, east, south] = extent;
  if (!(west < east && south < north)) return undefined;
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined;
  return { east, north, south, west } satisfies GeographicBounds;
}

function label(properties: EngineFeature['properties'], housenumber: string | undefined) {
  if (properties.name !== undefined && properties.name.length > 0) return properties.name;
  if (properties.street !== undefined && housenumber !== undefined) {
    return `${properties.street} ${housenumber}`;
  }
  return (
    housenumber ??
    properties.street ??
    properties.locality ??
    properties.district ??
    properties.city ??
    properties.county ??
    properties.state
  );
}

function mapFeature(feature: EngineFeature, context: MappingContext): PlaceResult | undefined {
  if (isCanary(feature)) return undefined;
  const { properties } = feature;
  const id = placeId(properties.osm_type, properties.osm_id);
  if (id === undefined) return undefined;

  const [longitude, latitude] = feature.geometry.coordinates;
  if (!within(context.bounds, longitude, latitude)) return undefined;

  // Canonicalised numbers are searchable; the originals are what a person should see.
  const housenumber = properties.extra?.[ORIGINAL_HOUSENUMBER_KEY] ?? properties.housenumber;
  const postcode = properties.extra?.[ORIGINAL_POSTCODE_KEY] ?? properties.postcode;
  const name = label(properties, housenumber);
  if (
    name === undefined ||
    properties.osm_key === undefined ||
    properties.osm_value === undefined
  ) {
    return undefined;
  }

  const address: Record<string, string> = {};
  const parts: readonly (readonly [string, string | undefined])[] = [
    ['housenumber', housenumber],
    ['street', properties.street],
    ['locality', properties.locality],
    ['district', properties.district],
    ['city', properties.city],
    ['county', properties.county],
    ['state', properties.state],
    ['country', properties.country],
    ['postcode', postcode],
    ['countryCode', properties.countrycode?.toLowerCase()],
  ];
  for (const [key, value] of parts) {
    if (value !== undefined && value.length > 0) address[key] = value;
  }

  const bounds = extentBounds(properties.extent);
  const kind =
    properties.type !== undefined && KINDS.has(properties.type) ? properties.type : undefined;
  return {
    address,
    category: `${properties.osm_key}:${properties.osm_value}`,
    coordinate: { latitude, longitude },
    id,
    name,
    ...(kind === undefined ? {} : { kind: kind as PlaceKind }),
    ...(bounds === undefined ? {} : { bounds }),
  };
}

/**
 * Projects an engine response onto provider-neutral place results.
 *
 * Drops the generation canary by its exact identity, anything that is not an OpenStreetMap
 * object, and anything outside the snapshot's bounds. Order is preserved.
 */
export function mapEngineCollection(
  collection: EngineCollection,
  context: MappingContext,
): PlaceResult[] {
  const results: PlaceResult[] = [];
  for (const feature of collection.features) {
    const mapped = mapFeature(feature, context);
    if (mapped !== undefined) results.push(mapped);
  }
  return results;
}
