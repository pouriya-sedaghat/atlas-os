import { createHash } from 'node:crypto';

/**
 * Everything a search generation is bound to.
 *
 * Each field changes when the generation changes: the snapshot, the exact source bytes, the
 * source's publisher timestamp, the post-processed dump the engine imported, and the unique
 * import instant the engine reports back on every status call.
 */
export interface GenerationInputs {
  readonly snapshotId: string;
  /** `sha256:<hex>` of the regional extract, or of the synthetic fixture definition. */
  readonly sourceChecksum: string;
  readonly sourceTimestamp: string;
  /** `sha256:<hex>` of the post-processed dump, before the canary line is appended. */
  readonly dumpChecksum: string;
  /** ISO-8601 instant with millisecond precision. */
  readonly engineImportDate: string;
}

const DOMAIN = 'atlas-os/search-generation/v1';

/** The cryptographic marker the generation canary carries and every engine load is checked against. */
export function generationMarker(inputs: GenerationInputs): string {
  const material = [
    DOMAIN,
    inputs.snapshotId,
    inputs.sourceChecksum,
    inputs.sourceTimestamp,
    inputs.dumpChecksum,
    inputs.engineImportDate,
  ];
  for (const part of material) {
    if (part.includes('\n')) throw new Error('Generation marker inputs must not contain newlines.');
  }
  return `sha256:${createHash('sha256').update(material.join('\n'), 'utf8').digest('hex')}`;
}

/**
 * A unique, millisecond-precision import instant for a new generation.
 *
 * The engine echoes this back exactly, so it doubles as a cheap per-request handle; uniqueness
 * against the other slot is enforced by the provisioner before promotion.
 */
export function engineImportInstant(now: Date): string {
  return now.toISOString();
}
