import { PlatformError } from '../../errors.js';
import { decodeRelativePath } from '../fs/paths.js';
import { parseRangeName } from '../glyphs/ranges.js';
import {
  ARCHIVE_FILE,
  ARCHIVE_MEDIA_TYPE,
  BASEMAP_DIRECTORY,
  FONTSTACK,
  GLYPHS_DIRECTORY,
  RESOURCE_SCHEMA_VERSION,
  SPRITE_BASENAME,
  STYLE_FILE,
} from './layout.js';

const snapshotIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export interface ResolvedResource {
  readonly contentType: string;
  /** Path segments beneath the snapshot slot directory. */
  readonly segments: readonly string[];
  readonly snapshotId: string;
}

function notFound(resource: string): never {
  throw new PlatformError('NOT_FOUND', 'Requested basemap resource does not exist.', {
    details: { resource },
  });
}

/**
 * Maps a request path onto an allowlisted file inside one snapshot.
 *
 * This is an allowlist, not a filter: a path is served only if it matches one of the shapes
 * below exactly. Nothing else under the data root is reachable, so adding an unrelated file to a
 * snapshot directory does not publish it.
 */
export function resolveBasemapResource(pathname: string): ResolvedResource {
  const segments = decodeRelativePath(pathname);
  const [schemaVersion, snapshotId, ...resource] = segments;

  if (schemaVersion !== RESOURCE_SCHEMA_VERSION) notFound(pathname);
  if (snapshotId === undefined || !snapshotIdPattern.test(snapshotId)) notFound(pathname);
  if (resource.length === 0) notFound(pathname);

  const under = (...parts: readonly string[]): readonly string[] => [BASEMAP_DIRECTORY, ...parts];

  if (resource.length === 1) {
    const [name] = resource;
    if (name === ARCHIVE_FILE) {
      return { contentType: ARCHIVE_MEDIA_TYPE, segments: under(ARCHIVE_FILE), snapshotId };
    }
    if (name === STYLE_FILE) {
      return {
        contentType: 'application/json; charset=utf-8',
        segments: under(STYLE_FILE),
        snapshotId,
      };
    }
    if (name === `${SPRITE_BASENAME}.json` || name === `${SPRITE_BASENAME}@2x.json`) {
      return { contentType: 'application/json; charset=utf-8', segments: under(name), snapshotId };
    }
    if (name === `${SPRITE_BASENAME}.png` || name === `${SPRITE_BASENAME}@2x.png`) {
      return { contentType: 'image/png', segments: under(name), snapshotId };
    }
    notFound(pathname);
  }

  if (resource.length === 3 && resource[0] === GLYPHS_DIRECTORY) {
    const fontstack = resource[1]!;
    const file = resource[2]!;
    if (fontstack !== FONTSTACK) notFound(pathname);
    if (!file.endsWith('.pbf')) notFound(pathname);
    if (parseRangeName(file.slice(0, -'.pbf'.length)) === undefined) notFound(pathname);
    return {
      contentType: 'application/x-protobuf',
      segments: under(GLYPHS_DIRECTORY, fontstack, file),
      snapshotId,
    };
  }

  notFound(pathname);
}
