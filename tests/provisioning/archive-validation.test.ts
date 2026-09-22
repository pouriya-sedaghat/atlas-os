import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseSnapshotManifest } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { encodeTilePyramid } from '../../packages/atlas-os/src/internal/mvt/encode.js';
import { buildPmtilesArchive } from '../../packages/atlas-os/src/internal/pmtiles/writer.js';
import { inspectArchive } from '../../packages/atlas-os/src/internal/pmtiles/inspect.js';
import { sha256File } from '../../packages/atlas-os/src/internal/fs/checksum.js';
import { validateSnapshotTree } from '../../packages/atlas-os/src/internal/snapshot/validate.js';
import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

const contexts: TestPlatform[] = [];
const BOUNDS = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 } as const;

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.cleanup()));
});

async function prepared(): Promise<{ context: TestPlatform; snapshotId: string; slot: string }> {
  const context = await createTestPlatform();
  contexts.push(context);
  const snapshotId = await context.platform.datasets.prepareUpdate({
    inputs: [],
    sourceName: 'fixture',
  });
  return { context, slot: 'blue', snapshotId };
}

function slotRoot(context: TestPlatform, slot: string): string {
  return join(context.dataRoot, 'slots', slot);
}

async function revalidate(context: TestPlatform, slot: string) {
  return validateSnapshotTree({
    expectedRegion: 'iran',
    snapshotRoot: slotRoot(context, slot),
  });
}

/** Rewrites the manifest and repairs its own checksum entry so only the target check can fail. */
async function rewriteManifest(
  context: TestPlatform,
  slot: string,
  mutate: (manifest: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(slotRoot(context, slot), 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  mutate(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Builds a structurally valid archive whose own metadata declares different layers, and installs
 * it in place of the prepared one. The manifest and the style are untouched, so only a validation
 * that reads the archive's own declaration can detect the incompatibility.
 */
async function replaceArchiveWithIncompatibleLayers(
  context: TestPlatform,
  slot: string,
  declaredLayers: readonly string[],
): Promise<void> {
  const tiles = encodeTilePyramid(
    [
      {
        features: {
          features: [
            {
              geometry: { coordinates: [51.389, 35.6892], type: 'Point' },
              properties: { name: 'Sample' },
              type: 'Feature',
            },
          ],
          type: 'FeatureCollection',
        },
        maxZoom: 2,
        minZoom: 0,
        name: declaredLayers[0] ?? 'unrelated',
      },
    ],
    { maxZoom: 2, windows: [{ bounds: BOUNDS, maxZoom: 2, minZoom: 0 }] },
  );

  const manifestPath = join(slotRoot(context, slot), 'manifest.json');
  const manifest = parseSnapshotManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const basemap = manifest.basemap!;

  const archive = buildPmtilesArchive(tiles, {
    bounds: BOUNDS,
    center: { latitude: 35.6892, longitude: 51.389, zoom: 2 },
    maxZoom: basemap.maxZoom,
    metadata: {
      attribution: basemap.attribution,
      name: 'atlas-os-fixture',
      vector_layers: declaredLayers.map((id) => ({ id, maxzoom: 2, minzoom: 0 })),
      version: '1',
    },
    minZoom: basemap.minZoom,
  });

  const archivePath = join(slotRoot(context, slot), 'basemap', 'basemap.pmtiles');
  await writeFile(archivePath, archive);

  // Keep every other check satisfied so the failure is unambiguous.
  const summary = await inspectArchive(archivePath);
  await rewriteManifest(context, slot, (raw) => {
    const checksums = raw['checksums'] as Record<string, string>;
    const component = raw['basemap'] as Record<string, unknown>;
    component['tileCount'] = summary.tileCount;
    checksums['basemap/basemap.pmtiles'] = 'sha256:placeholder';
  });
  const digest = await sha256File(archivePath);
  await rewriteManifest(context, slot, (raw) => {
    (raw['checksums'] as Record<string, string>)['basemap/basemap.pmtiles'] = digest;
  });
}

describe('archive-derived validation', () => {
  it('rejects an archive whose declared layers cannot satisfy the style', async () => {
    const { context, slot, snapshotId } = await prepared();
    await expect(revalidate(context, slot)).resolves.toMatchObject({ valid: true });

    // A structurally valid archive that simply does not contain what the style draws.
    await replaceArchiveWithIncompatibleLayers(context, slot, ['unrelated_layer']);

    const report = await revalidate(context, slot);
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((check) => check.status === 'failed').map((c) => c.name);
    // The manifest still claims the original layers, so the mismatch is only visible by reading
    // the archive itself.
    expect(failed).toContain('archive_layers');

    await expect(
      context.platform.datasets.activateSnapshot(snapshotId as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(context.platform.atlas.basemap()).resolves.toMatchObject({
      availability: 'not_installed',
    });
  });

  it('rejects an archive that omits only some of the style layers', async () => {
    const { context, slot } = await prepared();
    await replaceArchiveWithIncompatibleLayers(context, slot, ['water', 'place']);

    const report = await revalidate(context, slot);
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((check) => check.status === 'failed').map((c) => c.name);
    expect(failed).toContain('archive_layers');
  });

  it('rejects an archive whose declared bounds disagree with the manifest', async () => {
    const { context, slot } = await prepared();
    await rewriteManifest(context, slot, (raw) => {
      const component = raw['basemap'] as Record<string, unknown>;
      component['bounds'] = { east: 10, north: 10, south: 0, west: 0 };
    });

    const report = await revalidate(context, slot);
    expect(report.valid).toBe(false);
    expect(report.checks.filter((check) => check.status === 'failed').map((c) => c.name)).toContain(
      'archive_bounds',
    );
  });

  it('rejects an archive whose declared attribution disagrees with the manifest', async () => {
    const { context, slot } = await prepared();
    await rewriteManifest(context, slot, (raw) => {
      const component = raw['basemap'] as Record<string, unknown>;
      component['attribution'] = 'Someone else entirely';
    });

    const report = await revalidate(context, slot);
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((check) => check.status === 'failed').map((c) => c.name);
    expect(failed).toContain('archive_attribution');
  });

  it('rejects a snapshot whose schema version disagrees with the archive', async () => {
    const { context, slot } = await prepared();
    await rewriteManifest(context, slot, (raw) => {
      (raw['artifactVersions'] as Record<string, string>)['schema'] = 'OpenMapTiles@9.9.9';
    });

    const report = await revalidate(context, slot);
    expect(report.valid).toBe(false);
    expect(report.checks.filter((check) => check.status === 'failed').map((c) => c.name)).toContain(
      'archive_schema',
    );
  });

  it('proves a representative tile decodes to declared layers', async () => {
    const { context, slot } = await prepared();
    const report = await revalidate(context, slot);

    const tileCheck = report.checks.find((check) => check.name === 'archive_tile');
    expect(tileCheck?.status).toBe('passed');
    expect(tileCheck?.message).toMatch(/decodes to \d+ vector layers/);
  });

  it('rejects a manifest whose checksum key escapes the snapshot', async () => {
    const { context, slot } = await prepared();

    for (const unsafe of [
      '../../../etc/passwd',
      '/etc/passwd',
      'basemap/../../escape.json',
      'basemap\\style.json',
      'basemap//style.json',
      './style.json',
    ]) {
      await rewriteManifest(context, slot, (raw) => {
        const checksums = raw['checksums'] as Record<string, string>;
        checksums[unsafe] = `sha256:${'0'.repeat(64)}`;
      });

      const report = await revalidate(context, slot);
      expect(report.valid, `checksum key ${unsafe} was accepted`).toBe(false);
      // The manifest itself is refused, so no checksum target is ever opened.
      expect(report.checks[0]?.name).toBe('manifest');
      expect(report.checks[0]?.status).toBe('failed');

      await rewriteManifest(context, slot, (raw) => {
        delete (raw['checksums'] as Record<string, string>)[unsafe];
      });
    }
  });

  it('accepts the snapshot again once the tampering is undone', async () => {
    const { context, slot, snapshotId } = await prepared();
    await expect(revalidate(context, slot)).resolves.toMatchObject({ valid: true });
    await context.platform.datasets.activateSnapshot(snapshotId as never);
    await expect(context.platform.atlas.basemap()).resolves.toMatchObject({
      availability: 'ready',
    });
  });
});

describe('installed snapshot still validates', () => {
  it('passes every archive-derived check for a freshly installed snapshot', async () => {
    const context = await createTestPlatform();
    contexts.push(context);
    await installSnapshot(context.platform);

    const report = await revalidate(context, 'blue');
    expect(report.valid).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'archive',
        'archive_attribution',
        'archive_bounds',
        'archive_layers',
        'archive_schema',
        'archive_tile',
      ]),
    );
  });
});
