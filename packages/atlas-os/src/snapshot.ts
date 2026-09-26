import { z } from 'zod';

import type { SnapshotId } from './contracts.js';
import { PlatformError } from './errors.js';

const componentStateSchema = z.enum(['ready', 'unavailable', 'failed']);
const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const snapshotIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);

export const SLOTS = ['blue', 'green'] as const;
export type SlotName = (typeof SLOTS)[number];
export const slotSchema = z.enum(SLOTS);

const boundsSchema = z
  .object({
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
  })
  .strict();

/**
 * Metadata for the vector basemap component of a snapshot.
 *
 * `vectorFormat` and `mediaType` are recorded separately on purpose: the archive container and
 * the tile payload inside it are different things, and a snapshot is only usable when the payload
 * really is vector data.
 */
const basemapComponentSchema = z
  .object({
    archiveBytes: z.number().int().nonnegative(),
    attribution: z.string().min(1),
    bounds: boundsSchema,
    glyphRanges: z.array(z.string().regex(/^\d{1,5}-\d{1,5}$/)).min(1),
    labelLanguages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1),
    maxZoom: z.number().int().min(0).max(22),
    mediaType: z.literal('application/vnd.pmtiles'),
    minZoom: z.number().int().min(0).max(22),
    sourceLayers: z.array(z.string().min(1)).min(1),
    tileCount: z.number().int().positive(),
    vectorFormat: z.literal('mvt'),
  })
  .strict();

/**
 * Provenance for one operator-supplied input.
 *
 * Only the file name is recorded, never the absolute host path: a manifest travels with the
 * snapshot and must not disclose the layout of the machine that built it.
 */
const datasetInputSchema = z
  .object({
    bytes: z.number().int().positive(),
    checksum: checksumSchema,
    filename: z.string().min(1).max(255),
    kind: z.enum([
      'region_extract',
      'reference_features',
      'coastline_polygons',
      'lake_centerlines',
    ]),
    name: z.string().min(1),
    timestamp: z.iso.datetime().nullable(),
  })
  .strict();

/**
 * A checksum key addresses an artifact inside the snapshot directory.
 *
 * Constrained so a manifest cannot direct a reader outside the snapshot: relative POSIX paths
 * only, with no absolute root, no traversal, no backslash and no empty segment.
 */
const artifactPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.startsWith('/') && !/^[a-zA-Z]:/.test(value), {
    message: 'Artifact paths must be relative.',
  })
  .refine((value) => !value.includes('\\'), { message: 'Artifact paths must use forward slashes.' })
  .refine((value) => !value.includes('\0'), { message: 'Artifact paths must not contain NUL.' })
  .refine(
    (value) =>
      value
        .split('/')
        .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    { message: 'Artifact paths must not contain empty or traversal segments.' },
  );

/**
 * Fields shared by every manifest schema version.
 *
 * Schema version 1 is exactly the M1 shape and is frozen: a snapshot written by M1 must keep
 * parsing, validating and activating unchanged, and must never be rewritten to migrate it.
 */
const commonManifestShape = {
  /**
   * State recorded when the snapshot was written. `data/active.json` is the authoritative
   * record of which snapshot is serving; a slot manifest is never rewritten to flip this.
   */
  activation: z.enum(['inactive', 'active', 'previous']),
  artifactVersions: z.record(z.string(), z.string()),
  checksums: z.record(artifactPathSchema, checksumSchema),
  components: z.record(z.string(), componentStateSchema),
  createdAt: z.iso.datetime(),
  region: z.string().min(1),
  slot: slotSchema.optional(),
  snapshotId: snapshotIdSchema,
  source: z.object({
    name: z.string().min(1),
    timestamp: z.iso.datetime(),
  }),
  validation: z.enum(['pending', 'passed', 'failed']),
};

const snapshotManifestV1Schema = z
  .object({
    ...commonManifestShape,
    basemap: basemapComponentSchema.optional(),
    inputs: z.array(datasetInputSchema).optional(),
    schemaVersion: z.literal(1),
  })
  .strict();

/** An instant with exactly millisecond precision, as the search engine reports it back. */
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid instant.' });

const searchLanguageSchema = z.enum(['fa', 'en']);

/** A stable public place identifier derived from the OpenStreetMap object type and ID. */
export const placeIdSchema = z.string().regex(/^osm:(node|way|relation):[1-9][0-9]{0,18}$/);

const coordinateSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

/**
 * A deterministic question the sealed search database must answer, recorded when it is built and
 * asked again every time an engine loads it.
 */
const searchProbeSchema = z.discriminatedUnion('type', [
  z
    .object({
      expectId: placeIdSchema,
      language: searchLanguageSchema,
      query: z.string().min(2).max(100),
      type: z.literal('search'),
    })
    .strict(),
  z
    .object({
      coordinate: coordinateSchema,
      expectId: placeIdSchema,
      language: searchLanguageSchema,
      type: z.literal('reverse'),
    })
    .strict(),
]);

/** The probes a snapshot records: at least one, at most 64. */
export const searchProbesSchema = z.array(searchProbeSchema).min(1).max(64);

/**
 * Where the searchable places came from.
 *
 * Production snapshots derive them from the same operator-supplied regional extract as the
 * basemap. The synthetic development fixture has no extract at all, and says so explicitly
 * rather than pretending to one.
 */
const searchSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      bytes: z.number().int().positive(),
      checksum: checksumSchema,
      kind: z.literal('region_extract'),
    })
    .strict(),
  z
    .object({
      checksum: checksumSchema,
      kind: z.literal('synthetic'),
    })
    .strict(),
]);

const searchAttributionSchema = z.union([
  z
    .object({
      licence: z.literal('ODbL-1.0'),
      text: z.literal('© OpenStreetMap contributors'),
      url: z.literal('https://www.openstreetmap.org/copyright'),
    })
    .strict(),
  z
    .object({
      licence: z.literal('none'),
      text: z.literal('Synthetic development fixture — not map data'),
      url: z.null(),
    })
    .strict(),
]);

const toolIdentitySchema = z
  .object({
    name: z.string().min(1).max(64),
    sha256: checksumSchema.optional(),
    version: z.string().min(1).max(64),
  })
  .strict();

/**
 * The search component of a schema-2 snapshot.
 *
 * The sealed engine database lives read-only under `root`; every file in it is also listed in the
 * manifest's `checksums`. `treeDigest` covers paths, types, modes, sizes and hashes of the whole
 * tree, and `generationMarker` binds the snapshot, its source, the post-processed dump and the
 * engine import date together.
 */
const searchComponentSchema = z
  .object({
    attribution: searchAttributionSchema,
    canary: z
      .object({
        coordinate: coordinateSchema,
        objectId: z.literal(0),
        objectType: z.literal('X'),
      })
      .strict(),
    dump: z
      .object({
        bytes: z.number().int().positive(),
        documents: z.number().int().nonnegative(),
        places: z.number().int().nonnegative(),
        sha256: checksumSchema,
        variants: z
          .object({
            addresses: z.number().int().nonnegative(),
            housenumbers: z.number().int().nonnegative(),
            names: z.number().int().nonnegative(),
            postcodes: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    engine: z
      .object({
        bytes: z.number().int().positive(),
        directories: z.number().int().positive(),
        files: z.number().int().positive(),
        importDate: instantSchema,
        root: z.literal('search/engine'),
        treeDigest: checksumSchema,
      })
      .strict(),
    generationMarker: checksumSchema,
    languages: z
      .array(searchLanguageSchema)
      .length(2)
      .refine((languages) => new Set(languages).size === 2, {
        message: 'Search languages must be fa and en.',
      }),
    probes: searchProbesSchema,
    source: searchSourceSchema,
    tools: z.array(toolIdentitySchema).min(1).max(16),
  })
  .strict();

const snapshotManifestV2Schema = z
  .object({
    ...commonManifestShape,
    basemap: basemapComponentSchema,
    inputs: z.array(datasetInputSchema),
    schemaVersion: z.literal(2),
    search: searchComponentSchema,
  })
  .strict();

export const snapshotManifestSchema = z.discriminatedUnion('schemaVersion', [
  snapshotManifestV1Schema,
  snapshotManifestV2Schema,
]);

type WithSnapshotId<T> = Omit<T, 'snapshotId'> & { readonly snapshotId: SnapshotId };

export type SnapshotManifestV1 = WithSnapshotId<z.infer<typeof snapshotManifestV1Schema>>;
export type SnapshotManifestV2 = WithSnapshotId<z.infer<typeof snapshotManifestV2Schema>>;
export type SnapshotManifest = SnapshotManifestV1 | SnapshotManifestV2;

export type BasemapComponent = z.infer<typeof basemapComponentSchema>;
export type SearchComponent = z.infer<typeof searchComponentSchema>;
export type SearchProbe = z.infer<typeof searchProbeSchema>;
export type SearchSource = z.infer<typeof searchSourceSchema>;
export type ManifestInput = z.infer<typeof datasetInputSchema>;

/** The search component a manifest carries, or `undefined` for a schema-1 (basemap-only) one. */
export function searchComponentOf(manifest: SnapshotManifest): SearchComponent | undefined {
  return manifest.schemaVersion === 2 ? manifest.search : undefined;
}

export function parseSnapshotManifest(input: unknown): SnapshotManifest {
  const result = snapshotManifestSchema.safeParse(input);
  if (!result.success) {
    throw new PlatformError('VALIDATION_FAILED', 'Snapshot manifest is invalid.', {
      details: { issues: result.error.issues },
    });
  }
  return result.data as SnapshotManifest;
}

/** The pointer file naming the snapshot that is currently serving requests. */
export const activePointerSchema = z
  .object({
    activatedAt: z.iso.datetime(),
    previous: z
      .object({
        activatedAt: z.iso.datetime(),
        slot: slotSchema,
        snapshotId: snapshotIdSchema,
      })
      .strict()
      .nullable(),
    schemaVersion: z.literal(1),
    slot: slotSchema,
    snapshotId: snapshotIdSchema,
  })
  .strict();

export type ActivePointer = z.infer<typeof activePointerSchema>;

export function parseActivePointer(input: unknown): ActivePointer {
  const result = activePointerSchema.safeParse(input);
  if (!result.success) {
    throw new PlatformError('VALIDATION_FAILED', 'Active snapshot pointer is invalid.', {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}
