import type { BasemapDescriptor, BasemapUnavailableReason, SnapshotId } from '../../contracts.js';
import type { SnapshotManifest } from '../../snapshot.js';
import { ARCHIVE_MEDIA_TYPE, archiveUrl, glyphUrlTemplate, spriteUrl, styleUrl } from './layout.js';

/**
 * Projects a validated snapshot manifest onto the public, renderer-neutral basemap descriptor.
 *
 * Only local, snapshot-versioned URLs are exposed. Nothing here names a tile tool, a tile schema
 * or a rendering SDK, and no filesystem path leaves the package.
 */
export function readyBasemapDescriptor(manifest: SnapshotManifest): BasemapDescriptor | undefined {
  const basemap = manifest.basemap;
  if (basemap === undefined) return undefined;

  const snapshotId = manifest.snapshotId as SnapshotId;
  return {
    attribution: basemap.attribution,
    availability: 'ready',
    bounds: {
      east: basemap.bounds.east,
      north: basemap.bounds.north,
      south: basemap.bounds.south,
      west: basemap.bounds.west,
    },
    glyphUrlTemplate: glyphUrlTemplate(snapshotId),
    labelLanguages: [...basemap.labelLanguages],
    maxZoom: basemap.maxZoom,
    mediaType: ARCHIVE_MEDIA_TYPE,
    minZoom: basemap.minZoom,
    resourceUrl: archiveUrl(snapshotId),
    snapshotId,
    spriteUrl: spriteUrl(snapshotId),
    styleDescriptorUrl: styleUrl(snapshotId),
    vectorFormat: 'mvt',
  };
}

export const NOT_INSTALLED_BASEMAP: BasemapDescriptor = {
  availability: 'not_installed',
  reason: 'dataset_not_installed',
};

/**
 * A dataset is installed but cannot serve a basemap.
 *
 * Carries a reason and a human-readable detail, and — like the not-installed variant — no
 * snapshot identifier and no resource URL.
 */
export function unavailableBasemap(
  reason: BasemapUnavailableReason,
  detail: string,
): BasemapDescriptor {
  return { availability: 'unavailable', detail, reason };
}
