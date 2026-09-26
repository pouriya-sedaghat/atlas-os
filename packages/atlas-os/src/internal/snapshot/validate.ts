import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { ValidationReport } from '../../contracts.js';
import type { SnapshotManifest } from '../../snapshot.js';
import { parseSnapshotManifest } from '../../snapshot.js';
import { checksumsMatch, sha256File } from '../fs/checksum.js';
import { GLYPHS_DIRECTORY, MANIFEST_FILE } from '../basemap/layout.js';
import {
  REQUIRED_SOURCE_LAYERS,
  isLocalResourceUrl,
  styleDeclaresAttribution,
  styleFetchedUrls,
  styleSourceLayers,
} from '../basemap/style.js';
import type { ArchiveSummary } from '../pmtiles/inspect.js';
import { findRepresentativeTile, inspectArchive } from '../pmtiles/inspect.js';
import { decodeTileLayers } from '../mvt/decode.js';
import { isEngineArtifact, validateSearchComponent } from './validate-search.js';

type CheckStatus = 'passed' | 'failed';

interface MutableCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

class CheckCollector {
  readonly #checks: MutableCheck[] = [];

  pass(name: string, message: string): void {
    this.#checks.push({ message, name, status: 'passed' });
  }

  fail(name: string, message: string): void {
    this.#checks.push({ message, name, status: 'failed' });
  }

  async run(name: string, operation: () => Promise<string>): Promise<boolean> {
    try {
      this.pass(name, await operation());
      return true;
    } catch (error) {
      this.fail(name, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  report(): ValidationReport {
    return {
      checkedAt: new Date().toISOString(),
      checks: [...this.#checks],
      valid: this.#checks.every((check) => check.status === 'passed'),
    };
  }
}

export interface ValidationContext {
  readonly expectedRegion: string;
  readonly snapshotRoot: string;
}

/**
 * Validates a snapshot tree on disk.
 *
 * This runs before a snapshot is promoted into a slot and again before it is activated, so a
 * corrupt, incomplete or foreign-region snapshot can never become the serving dataset. It only
 * reads; it never repairs or mutates what it inspects.
 */
export async function validateSnapshotTree(context: ValidationContext): Promise<ValidationReport> {
  const checks = new CheckCollector();
  const manifestPath = join(context.snapshotRoot, MANIFEST_FILE);

  let manifest: SnapshotManifest | undefined;
  await checks.run('manifest', async () => {
    manifest = parseSnapshotManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
    return `Manifest ${manifest.snapshotId} matches schema version ${manifest.schemaVersion}.`;
  });
  if (manifest === undefined) return checks.report();
  const resolved = manifest;

  if (resolved.region === context.expectedRegion) {
    checks.pass('region', `Snapshot region ${resolved.region} matches the configured region.`);
  } else {
    checks.fail(
      'region',
      `Snapshot region ${resolved.region} does not match the configured region ${context.expectedRegion}.`,
    );
  }

  const basemap = resolved.basemap;
  if (basemap === undefined) {
    checks.fail('basemap_component', 'Snapshot does not declare a basemap component.');
    return checks.report();
  }
  checks.pass(
    'basemap_component',
    `Basemap declares ${basemap.tileCount} tiles across zoom ${basemap.minZoom}-${basemap.maxZoom}.`,
  );

  // A sealed search database is verified file by file, against its digest and its exact file
  // set, by the search checks below; hashing it twice would double the cost on a large region.
  const checksumEntries = Object.entries(resolved.checksums).filter(
    ([path]) => resolved.schemaVersion !== 2 || !isEngineArtifact(path),
  );
  if (checksumEntries.length === 0) {
    checks.fail('checksums', 'Snapshot records no artifact checksums.');
  } else {
    await checks.run('checksums', async () => {
      for (const [relativePath, expected] of checksumEntries) {
        const absolute = join(context.snapshotRoot, relativePath);
        const details = await stat(absolute).catch(() => undefined);
        if (details === undefined || !details.isFile()) {
          throw new Error(`Recorded artifact is missing: ${relativePath}.`);
        }
        const actual = await sha256File(absolute);
        if (!checksumsMatch(expected, actual)) {
          throw new Error(`Checksum mismatch for ${relativePath}.`);
        }
      }
      return `Verified ${checksumEntries.length} artifact checksums.`;
    });
  }

  let archiveSummary: ArchiveSummary | undefined;
  await checks.run('archive', async () => {
    const archiveRelative = Object.keys(resolved.checksums).find((path) =>
      path.endsWith('.pmtiles'),
    );
    if (archiveRelative === undefined) throw new Error('Snapshot records no tile archive.');
    const summary = await inspectArchive(join(context.snapshotRoot, archiveRelative));
    if (summary.vectorFormat !== 'mvt') throw new Error('Archive payload is not vector tile data.');
    if (summary.tileCount <= 0) throw new Error('Archive addresses no tiles.');
    if (summary.minZoom !== basemap.minZoom || summary.maxZoom !== basemap.maxZoom) {
      throw new Error(
        `Archive zoom range ${summary.minZoom}-${summary.maxZoom} disagrees with the manifest.`,
      );
    }
    if (summary.tileCount !== basemap.tileCount) {
      throw new Error(
        `Archive holds ${summary.tileCount} tiles but the manifest records ${basemap.tileCount}.`,
      );
    }
    archiveSummary = summary;
    return `Archive is a spec version ${summary.specVersion} vector archive with ${summary.tileCount} tiles.`;
  });
  if (archiveSummary === undefined) return checks.report();
  const archive = archiveSummary;

  // Everything below is checked against the archive's own metadata, never against a declaration
  // copied from whatever produced it. A builder that claims layers it did not emit is rejected.
  await checks.run('archive_layers', async () => {
    if (archive.vectorLayers.length === 0) {
      throw new Error('Archive declares no vector layers in its metadata.');
    }
    const undeclared = basemap.sourceLayers.filter(
      (layer) => !archive.vectorLayers.includes(layer),
    );
    if (undeclared.length > 0) {
      throw new Error(
        `Manifest declares layers the archive does not contain: ${undeclared.join(', ')}.`,
      );
    }
    return `Archive declares ${archive.vectorLayers.length} vector layers.`;
  });

  await checks.run('archive_bounds', async () => {
    const tolerance = 1e-6;
    const manifestBounds = basemap.bounds;
    const differences = (
      [
        ['west', archive.bounds.west, manifestBounds.west],
        ['south', archive.bounds.south, manifestBounds.south],
        ['east', archive.bounds.east, manifestBounds.east],
        ['north', archive.bounds.north, manifestBounds.north],
      ] as const
    ).filter(([, actual, expected]) => Math.abs(actual - expected) > tolerance);
    if (differences.length > 0) {
      throw new Error(
        `Archive bounds disagree with the manifest on: ${differences.map(([edge]) => edge).join(', ')}.`,
      );
    }
    return 'Archive bounds match the manifest.';
  });

  await checks.run('archive_attribution', async () => {
    if (archive.attribution === null) {
      throw new Error('Archive declares no attribution.');
    }
    if (archive.attribution !== basemap.attribution) {
      throw new Error('Archive attribution disagrees with the manifest.');
    }
    return 'Archive declares the attribution recorded in the manifest.';
  });

  await checks.run('archive_schema', async () => {
    const declared = resolved.artifactVersions['schema'];
    if (declared === undefined) throw new Error('Manifest records no schema version.');
    if (archive.schemaName === null || archive.schemaVersion === null) {
      // Not every producer writes schema identity into archive metadata; when it does, it must
      // agree with the manifest.
      return `Archive exposes no schema identity; manifest records ${declared}.`;
    }
    const expected = `${archive.schemaName}@${archive.schemaVersion}`;
    if (expected !== declared) {
      throw new Error(`Archive schema ${expected} disagrees with the manifest's ${declared}.`);
    }
    return `Archive and manifest agree on schema ${expected}.`;
  });

  await checks.run('archive_tile', async () => {
    const archiveRelative = Object.keys(resolved.checksums).find((path) =>
      path.endsWith('.pmtiles'),
    )!;
    const tile = await findRepresentativeTile(join(context.snapshotRoot, archiveRelative), archive);
    if (tile === undefined) throw new Error('Archive addresses tiles but none could be read.');
    const layers = decodeTileLayers(tile.data);
    if (layers.length === 0) {
      throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} decoded to no layers.`);
    }
    const unexpected = layers
      .map((layer) => layer.name)
      .filter((name) => !archive.vectorLayers.includes(name));
    if (unexpected.length > 0) {
      throw new Error(
        `Tile ${tile.z}/${tile.x}/${tile.y} carries undeclared layers: ${unexpected.join(', ')}.`,
      );
    }
    return `Tile ${tile.z}/${tile.x}/${tile.y} decodes to ${layers.length} vector layers.`;
  });

  await checks.run('style', async () => {
    const stylePath = Object.keys(resolved.checksums).find((path) => path.endsWith('style.json'));
    if (stylePath === undefined) throw new Error('Snapshot records no style document.');
    const style = JSON.parse(
      await readFile(join(context.snapshotRoot, stylePath), 'utf8'),
    ) as Record<string, unknown>;

    const referenced = styleSourceLayers(style);
    // Compared against the archive's own declaration, so a style cannot reference a layer the
    // archive does not actually contain.
    const missing = referenced.filter((layer) => !archive.vectorLayers.includes(layer));
    if (missing.length > 0) {
      throw new Error(
        `Style references source layers the archive does not provide: ${missing.join(', ')}.`,
      );
    }
    const expected = REQUIRED_SOURCE_LAYERS.filter((layer) => !referenced.includes(layer));
    if (expected.length > 0) {
      throw new Error(`Style omits required source layers: ${expected.join(', ')}.`);
    }
    const fetched = styleFetchedUrls(style).filter((url) => !isLocalResourceUrl(url));
    if (fetched.length > 0) {
      throw new Error(`Style fetches non-local resources: ${fetched.join(', ')}.`);
    }
    if (!styleDeclaresAttribution(style, basemap.attribution)) {
      throw new Error('Style does not carry the attribution recorded in the manifest.');
    }
    return `Style draws ${referenced.length} source layers from local resources only.`;
  });

  await checks.run('glyphs', async () => {
    const glyphFiles = Object.keys(resolved.checksums).filter((path) =>
      path.includes(`/${GLYPHS_DIRECTORY}/`),
    );
    const missing = basemap.glyphRanges.filter(
      (range) => !glyphFiles.some((path) => path.endsWith(`${range}.pbf`)),
    );
    if (missing.length > 0) throw new Error(`Glyph ranges are missing: ${missing.join(', ')}.`);
    return `All ${basemap.glyphRanges.length} declared glyph ranges are present.`;
  });

  await checks.run('sprites', async () => {
    const required = ['sprite.json', 'sprite.png', 'sprite@2x.json', 'sprite@2x.png'];
    const recorded = Object.keys(resolved.checksums);
    const missing = required.filter((name) => !recorded.some((path) => path.endsWith(name)));
    if (missing.length > 0) throw new Error(`Sprite resources are missing: ${missing.join(', ')}.`);
    return 'Sprite index and image are present at both pixel ratios.';
  });

  if (basemap.labelLanguages.length === 0) {
    checks.fail('label_languages', 'Snapshot declares no label languages.');
  } else {
    checks.pass('label_languages', `Labels support ${basemap.labelLanguages.join(', ')}.`);
  }

  const { bounds } = basemap;
  if (bounds.west < bounds.east && bounds.south < bounds.north) {
    checks.pass('bounds', 'Geographic bounds have increasing axes.');
  } else {
    checks.fail('bounds', 'Geographic bounds are inverted or empty.');
  }

  if (resolved.schemaVersion === 2) {
    await validateSearchComponent(checks, resolved, context.snapshotRoot);
  }

  return checks.report();
}
