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

export const snapshotManifestSchema = z
  .object({
    /**
     * State recorded when the snapshot was written. `data/active.json` is the authoritative
     * record of which snapshot is serving; a slot manifest is never rewritten to flip this.
     */
    activation: z.enum(['inactive', 'active', 'previous']),
    artifactVersions: z.record(z.string(), z.string()),
    basemap: basemapComponentSchema.optional(),
    checksums: z.record(artifactPathSchema, checksumSchema),
    components: z.record(z.string(), componentStateSchema),
    createdAt: z.iso.datetime(),
    inputs: z.array(datasetInputSchema).optional(),
    region: z.string().min(1),
    schemaVersion: z.literal(1),
    slot: slotSchema.optional(),
    snapshotId: snapshotIdSchema,
    source: z.object({
      name: z.string().min(1),
      timestamp: z.iso.datetime(),
    }),
    validation: z.enum(['pending', 'passed', 'failed']),
  })
  .strict();

export type SnapshotManifest = Omit<z.infer<typeof snapshotManifestSchema>, 'snapshotId'> & {
  readonly snapshotId: SnapshotId;
};

export type BasemapComponent = z.infer<typeof basemapComponentSchema>;

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
