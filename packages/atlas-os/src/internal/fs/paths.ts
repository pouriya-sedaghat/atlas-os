import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { PlatformError } from '../../errors.js';

const unsafeSegment = /^(?:|\.|\.\.)$/;
const unsafeCharacters = /[\0\\]/;

function reject(reason: string, segment: string): never {
  throw new PlatformError('INVALID_REQUEST', `Rejected unsafe resource path: ${reason}.`, {
    details: { reason, segment },
  });
}

/**
 * Decodes a single URL path segment once and rejects anything that could escape the snapshot
 * root. Percent-encoded traversal (`%2e%2e`, `%2f`) is rejected rather than normalised, so a
 * caller cannot smuggle a separator through a decode that a later `resolve` would honour.
 */
export function decodePathSegment(segment: string): string {
  if (segment.length === 0) reject('empty segment', segment);
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return reject('malformed percent-encoding', segment);
  }
  if (decoded !== segment && /[/\\]/.test(decoded)) reject('encoded path separator', segment);
  if (unsafeSegment.test(decoded)) reject('relative traversal segment', segment);
  if (unsafeCharacters.test(decoded)) reject('illegal character', segment);
  if (decoded.includes('/')) reject('embedded path separator', segment);
  return decoded;
}

/** Splits and validates a relative resource path such as `glyphs/atlas-os-regular/0-255.pbf`. */
export function decodeRelativePath(path: string): readonly string[] {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (trimmed.length === 0) reject('empty path', path);
  return trimmed.split('/').map(decodePathSegment);
}

/** True when `candidate` is `root` itself or lives underneath it. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const normalisedRoot = resolve(root);
  const normalisedCandidate = resolve(candidate);
  return (
    normalisedCandidate === normalisedRoot ||
    normalisedCandidate.startsWith(`${normalisedRoot}${sep}`)
  );
}

/**
 * Resolves `segments` under `root` and proves the result stays there even after symlinks are
 * followed. The lexical check runs first so a traversal never reaches the filesystem; the
 * `realpath` check then catches a symlink inside the snapshot pointing outside it.
 */
export async function resolveWithinRoot(
  root: string,
  segments: readonly string[],
): Promise<string> {
  const target = resolve(root, ...segments);
  if (!isWithinRoot(root, target)) reject('resolved outside the snapshot root', segments.join('/'));

  const realRoot = await realpath(root).catch(() => {
    throw new PlatformError('DATASET_UNAVAILABLE', 'Snapshot root is unavailable.', {
      details: { root },
    });
  });
  const realTarget = await realpath(target).catch(() => {
    throw new PlatformError('NOT_FOUND', 'Requested basemap resource does not exist.', {
      details: { resource: segments.join('/') },
    });
  });
  if (!isWithinRoot(realRoot, realTarget)) {
    reject('symbolic link escapes the snapshot root', segments.join('/'));
  }
  return realTarget;
}
