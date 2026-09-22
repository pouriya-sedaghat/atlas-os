/** Directory and URL layout shared by the provisioner and the resource server. */
export const BASEMAP_DIRECTORY = 'basemap';
export const ARCHIVE_FILE = 'basemap.pmtiles';
export const STYLE_FILE = 'style.json';
export const GLYPHS_DIRECTORY = 'glyphs';
export const SPRITE_BASENAME = 'sprite';
export const MANIFEST_FILE = 'manifest.json';

/** The single font stack the basemap style requests. */
export const FONTSTACK = 'atlas-os-regular';

/** Media type of the archive container. Its payload is Mapbox Vector Tile data. */
export const ARCHIVE_MEDIA_TYPE = 'application/vnd.pmtiles';

/**
 * Resource URLs carry a schema version and the immutable snapshot ID, so a client may cache them
 * forever: activating a new snapshot changes every URL rather than changing a file in place.
 */
export const RESOURCE_URL_PREFIX = '/maps';
export const RESOURCE_SCHEMA_VERSION = 'v1';

export function resourceBaseUrl(snapshotId: string): string {
  return `${RESOURCE_URL_PREFIX}/${RESOURCE_SCHEMA_VERSION}/${snapshotId}`;
}

export function archiveUrl(snapshotId: string): string {
  return `${resourceBaseUrl(snapshotId)}/${ARCHIVE_FILE}`;
}

export function styleUrl(snapshotId: string): string {
  return `${resourceBaseUrl(snapshotId)}/${STYLE_FILE}`;
}

/** The renderer appends `.json`, `.png` and the `@2x` variants to this base. */
export function spriteUrl(snapshotId: string): string {
  return `${resourceBaseUrl(snapshotId)}/${SPRITE_BASENAME}`;
}

export function glyphUrlTemplate(snapshotId: string): string {
  return `${resourceBaseUrl(snapshotId)}/${GLYPHS_DIRECTORY}/{fontstack}/{range}.pbf`;
}
