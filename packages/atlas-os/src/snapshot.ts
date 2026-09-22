import { z } from 'zod';

import type { SnapshotId } from './contracts.js';
import { PlatformError } from './errors.js';

const componentStateSchema = z.enum(['ready', 'unavailable', 'failed']);

export const snapshotManifestSchema = z
  .object({
    activation: z.enum(['inactive', 'active', 'previous']),
    artifactVersions: z.record(z.string(), z.string()),
    checksums: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
    components: z.record(z.string(), componentStateSchema),
    createdAt: z.iso.datetime(),
    region: z.string().min(1),
    schemaVersion: z.literal(1),
    snapshotId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
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

export function parseSnapshotManifest(input: unknown): SnapshotManifest {
  const result = snapshotManifestSchema.safeParse(input);
  if (!result.success) {
    throw new PlatformError('VALIDATION_FAILED', 'Snapshot manifest is invalid.', {
      details: { issues: result.error.issues },
    });
  }
  return result.data as SnapshotManifest;
}
