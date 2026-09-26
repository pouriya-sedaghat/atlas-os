import { join } from 'node:path';

import type { SnapshotManifestV2 } from '../../snapshot.js';
import { canonicalizeSearchText, significantLength } from '../search/canonical.js';
import { generationMarker } from '../search/marker.js';
import { ENGINE_ROOT, checkEngineHygiene, checkEngineStructure } from '../search/seal.js';
import type { TreeListing } from '../search/tree.js';
import { listTree } from '../search/tree.js';
import { checksumsMatch } from '../fs/checksum.js';

/** The subset of the validator's check collector this module drives. */
export interface CheckRunner {
  pass(name: string, message: string): void;
  run(name: string, operation: () => Promise<string>): Promise<boolean>;
}

/** Checksum keys that belong to the sealed engine tree, verified by the tree check below. */
export function isEngineArtifact(path: string): boolean {
  return path.startsWith(`${ENGINE_ROOT}/`);
}

function within(
  bounds: SnapshotManifestV2['basemap']['bounds'],
  coordinate: { readonly latitude: number; readonly longitude: number },
): boolean {
  return (
    coordinate.longitude >= bounds.west &&
    coordinate.longitude <= bounds.east &&
    coordinate.latitude >= bounds.south &&
    coordinate.latitude <= bounds.north
  );
}

/**
 * Semantic validation of a schema-2 search component.
 *
 * The schema proves the manifest is well formed; this proves it is true. The component is bound
 * to the same extract the basemap was built from, its generation marker is recomputed from its
 * inputs rather than trusted, and the sealed engine tree on disk must match the recorded digest,
 * file set, sizes, hashes and modes exactly, with no link, run-time output or host path in it.
 */
export async function validateSearchComponent(
  checks: CheckRunner,
  manifest: SnapshotManifestV2,
  snapshotRoot: string,
): Promise<void> {
  const { basemap, search } = manifest;

  await checks.run('search_component', async () => {
    if (manifest.components['search'] !== 'ready') {
      throw new Error('Snapshot does not mark its search component ready.');
    }
    if (within(basemap.bounds, search.canary.coordinate)) {
      throw new Error('The generation canary lies inside the public region.');
    }
    for (const probe of search.probes) {
      if (probe.type === 'reverse' && !within(basemap.bounds, probe.coordinate)) {
        throw new Error('A reverse probe lies outside the snapshot bounds.');
      }
      if (
        probe.type === 'search' &&
        (canonicalizeSearchText(probe.query) !== probe.query || significantLength(probe.query) < 2)
      ) {
        throw new Error('A search probe is not in canonical form.');
      }
    }
    return `Search declares ${search.probes.length} probes in ${search.languages.join(', ')}.`;
  });

  await checks.run('search_provenance', async () => {
    const extracts = manifest.inputs.filter((input) => input.kind === 'region_extract');
    if (search.source.kind === 'region_extract') {
      const { source } = search;
      const shared = extracts.find(
        (input) => input.checksum === source.checksum && input.bytes === source.bytes,
      );
      if (extracts.length !== 1 || shared === undefined) {
        throw new Error('Search was not built from the same regional extract as the basemap.');
      }
      if (search.attribution.licence !== 'ODbL-1.0') {
        throw new Error('Search built from a regional extract must carry its attribution.');
      }
      return 'Search and basemap share one regional extract.';
    }
    if (extracts.length > 0) {
      throw new Error('A snapshot built from a regional extract cannot declare synthetic search.');
    }
    if (search.attribution.licence !== 'none') {
      throw new Error('Synthetic search must not claim map data attribution.');
    }
    return 'Search is the synthetic development fixture and says so.';
  });

  await checks.run('search_generation', async () => {
    const expected = generationMarker({
      dumpChecksum: search.dump.sha256,
      engineImportDate: search.engine.importDate,
      snapshotId: manifest.snapshotId,
      sourceChecksum: search.source.checksum,
      sourceTimestamp: manifest.source.timestamp,
    });
    if (!checksumsMatch(expected, search.generationMarker)) {
      throw new Error('The generation marker does not match the recorded inputs.');
    }
    if (Date.parse(search.engine.importDate) > Date.parse(manifest.createdAt)) {
      throw new Error('The engine import date is later than the snapshot itself.');
    }
    return 'The generation marker binds the snapshot, source, dump and import date.';
  });

  await checks.run('search_engine_tree', async () => {
    const root = join(snapshotRoot, ...search.engine.root.split('/'));
    let listing: TreeListing;
    try {
      listing = await listTree(root, { hash: true });
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : 'The search engine artifact is unreadable.',
      );
    }
    checkEngineStructure(listing.entries);
    await checkEngineHygiene(root, listing.entries);

    const recorded = new Map(
      Object.entries(manifest.checksums)
        .filter(([path]) => isEngineArtifact(path))
        .map(([path, checksum]) => [path.slice(ENGINE_ROOT.length + 1), checksum] as const),
    );
    const files = listing.entries.filter((entry) => entry.type === 'file');
    if (files.length !== recorded.size) {
      throw new Error('The search engine artifact and the manifest list different files.');
    }
    for (const file of files) {
      const expected = recorded.get(file.path);
      if (expected === undefined) {
        throw new Error('The search engine artifact contains a file the manifest does not record.');
      }
      if (!checksumsMatch(expected, file.sha256!)) {
        throw new Error('A search engine file does not match its recorded checksum.');
      }
    }
    const { engine } = search;
    if (
      listing.bytes !== engine.bytes ||
      listing.files !== engine.files ||
      listing.directories !== engine.directories
    ) {
      throw new Error('The search engine artifact size disagrees with the manifest.');
    }
    if (!checksumsMatch(listing.digest, engine.treeDigest)) {
      throw new Error('The search engine tree digest disagrees with the manifest.');
    }
    return `Sealed search database verified: ${listing.files} files, ${listing.bytes} bytes.`;
  });
}
