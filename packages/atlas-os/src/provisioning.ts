import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { DatasetInput, SnapshotId, ValidationReport } from './contracts.js';
import { PlatformError } from './errors.js';
import type { SlotName, SnapshotManifest } from './snapshot.js';
import { searchComponentOf } from './snapshot.js';
import { createSnapshotId } from './validation.js';
import {
  ARCHIVE_FILE,
  BASEMAP_DIRECTORY,
  FONTSTACK,
  GLYPHS_DIRECTORY,
  MANIFEST_FILE,
  SPRITE_BASENAME,
  STYLE_FILE,
} from './internal/basemap/layout.js';
import { buildStyleDocument } from './internal/basemap/style.js';
import type { BasemapTileBuilder } from './internal/builders/types.js';
import { sha256Bytes, sha256File } from './internal/fs/checksum.js';
import { buildGlyphRanges } from './internal/glyphs/build.js';
import { BASEMAP_ICONS, buildSpriteSheet } from './internal/sprites/build.js';
import { inspectArchive } from './internal/pmtiles/inspect.js';
import { searchClusterMayBeRunning, type SearchPipeline } from './internal/search/pipeline.js';
import type { SnapshotStore } from './internal/snapshot/store.js';
import { validateSnapshotTree } from './internal/snapshot/validate.js';

export interface BasemapPreparationRequest {
  /** Operator-supplied inputs, validated by the builder before any tool is started. */
  readonly inputs: readonly DatasetInput[];
  /** Human-readable name of the preparation, recorded for provenance. */
  readonly sourceName: string;
  /** Publisher timestamp of the primary input, ISO-8601. Defaults to the preparation time. */
  readonly sourceTimestamp?: string | undefined;
}

export interface ProvisionerOptions {
  readonly bounds: {
    readonly east: number;
    readonly north: number;
    readonly south: number;
    readonly west: number;
  };
  readonly builder: BasemapTileBuilder;
  readonly fontPath: string;
  readonly labelLanguages: readonly string[];
  readonly region: string;
  /** Present when snapshots carry search; built from the same source as the basemap. */
  readonly search?: SearchPipeline | undefined;
  readonly store: SnapshotStore;
}

/**
 * `2026-09-22T07:20:00.123Z` becomes `20260922t072000123z`, which is URL- and path-safe.
 *
 * Millisecond precision is kept deliberately: the tile build is deterministic, so two
 * preparations from the same input produce the same archive digest and would otherwise be given
 * the same identifier.
 */
function compactTimestamp(date: Date): string {
  return date.toISOString().replaceAll(/[:.-]/g, '').toLowerCase();
}

function posixRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

/**
 * Drives the basemap snapshot lifecycle: prepare, validate, activate, roll back.
 *
 * Everything is built in a temporary directory, validated there, and only then promoted into the
 * inactive slot; activation is a single atomic pointer replacement. The active snapshot is never
 * written to, so a failed or abandoned preparation leaves the serving dataset untouched.
 */
export class BasemapProvisioner {
  readonly #options: ProvisionerOptions;

  constructor(options: ProvisionerOptions) {
    this.#options = options;
  }

  async prepare(request: BasemapPreparationRequest): Promise<SnapshotId> {
    const { store } = this.#options;
    return store.withLock(async () => {
      const slot = await store.inactiveSlot();
      const staging = await store.createStagingDirectory();
      try {
        const snapshotId = await this.#buildInto(staging, request, slot);
        const report = await validateSnapshotTree({
          expectedRegion: this.#options.region,
          snapshotRoot: staging,
        });
        if (!report.valid) {
          throw new PlatformError('VALIDATION_FAILED', 'Prepared snapshot failed validation.', {
            details: { failures: report.checks.filter((check) => check.status === 'failed') },
          });
        }
        // Two snapshots must never share an identifier: the active pointer and every resource
        // URL address a snapshot by it.
        const existing = await store.findSlot(snapshotId);
        if (existing !== undefined && existing !== slot) {
          throw new PlatformError('CONFLICT', 'A snapshot with that identifier already exists.', {
            details: { slot: existing, snapshotId },
          });
        }
        await store.promoteStaging(staging, slot);
        return snapshotId;
      } catch (error) {
        // A failed preparation never touches the active pointer. Only preserve the private
        // staging tree if the database builder has not proved PostgreSQL stopped: deleting its
        // files while it may still run is unsafe, particularly with local tooling.
        if (!(await searchClusterMayBeRunning(staging))) await store.discardStaging(staging);
        throw error;
      }
    });
  }

  async validate(snapshotId: SnapshotId): Promise<ValidationReport> {
    const slot = await this.#requireSlot(snapshotId);
    return validateSnapshotTree({
      expectedRegion: this.#options.region,
      snapshotRoot: this.#options.store.slotRoot(slot),
    });
  }

  /** Publishes a snapshot, but only after it validates on disk at this moment. */
  async activate(snapshotId: SnapshotId): Promise<void> {
    const { store } = this.#options;
    await store.withLock(async () => {
      const slot = await this.#requireSlot(snapshotId);
      const report = await validateSnapshotTree({
        expectedRegion: this.#options.region,
        snapshotRoot: store.slotRoot(slot),
      });
      if (!report.valid) {
        throw new PlatformError('VALIDATION_FAILED', 'Refusing to activate an invalid snapshot.', {
          details: {
            failures: report.checks.filter((check) => check.status === 'failed'),
            snapshotId,
          },
        });
      }
      await store.writeActivePointer(snapshotId, slot);
    });
  }

  async rollback(): Promise<void> {
    const { store } = this.#options;
    await store.withLock(async () => {
      const pointer = await store.readActivePointer();
      if (pointer === undefined || pointer.previous === null) {
        throw new PlatformError('CONFLICT', 'No previous snapshot is available to roll back to.');
      }
      const { previous } = pointer;
      const manifest = await store.readManifest(previous.slot);
      if (manifest === undefined || manifest.snapshotId !== previous.snapshotId) {
        throw new PlatformError('CONFLICT', 'The previous snapshot is no longer on disk.', {
          details: { slot: previous.slot, snapshotId: previous.snapshotId },
        });
      }
      const report = await validateSnapshotTree({
        expectedRegion: this.#options.region,
        snapshotRoot: store.slotRoot(previous.slot),
      });
      if (!report.valid) {
        throw new PlatformError('VALIDATION_FAILED', 'The previous snapshot no longer validates.', {
          details: { failures: report.checks.filter((check) => check.status === 'failed') },
        });
      }
      await store.writeActivePointer(previous.snapshotId, previous.slot);
    });
  }

  async #requireSlot(snapshotId: string): Promise<SlotName> {
    const slot = await this.#options.store.findSlot(snapshotId);
    if (slot === undefined) {
      throw new PlatformError('NOT_FOUND', 'No snapshot with that identifier is stored.', {
        details: { snapshotId },
      });
    }
    return slot;
  }

  async #buildInto(
    staging: string,
    request: BasemapPreparationRequest,
    slot: SlotName,
  ): Promise<SnapshotId> {
    const { bounds, builder, fontPath, labelLanguages, region, search, store } = this.#options;
    // Fixed once: the search generation is bound to it, so it must not drift during the build.
    const sourceTimestamp = request.sourceTimestamp ?? new Date().toISOString();
    const basemapDirectory = join(staging, BASEMAP_DIRECTORY);
    await mkdir(join(basemapDirectory, GLYPHS_DIRECTORY, FONTSTACK), { recursive: true });

    const archivePath = join(basemapDirectory, ARCHIVE_FILE);
    const build = await builder.build({
      archivePath,
      bounds,
      inputs: request.inputs,
      labelLanguages,
      region,
      sourceName: request.sourceName,
    });

    const summary = await inspectArchive(archivePath);
    const checksums: Record<string, string> = {};
    const record = async (absolute: string): Promise<void> => {
      checksums[posixRelative(staging, absolute)] = await sha256File(absolute);
    };
    await record(archivePath);

    const glyphRanges = buildGlyphRanges(fontPath, FONTSTACK);
    for (const artifact of glyphRanges) {
      const path = join(basemapDirectory, GLYPHS_DIRECTORY, FONTSTACK, `${artifact.range}.pbf`);
      await writeFile(path, artifact.data);
      await record(path);
    }

    for (const pixelRatio of [1, 2] as const) {
      const suffix = pixelRatio === 1 ? '' : '@2x';
      const sheet = buildSpriteSheet(BASEMAP_ICONS, pixelRatio);
      const pngPath = join(basemapDirectory, `${SPRITE_BASENAME}${suffix}.png`);
      const jsonPath = join(basemapDirectory, `${SPRITE_BASENAME}${suffix}.json`);
      await writeFile(pngPath, sheet.png);
      await writeFile(jsonPath, `${JSON.stringify(sheet.index, null, 2)}\n`);
      await record(pngPath);
      await record(jsonPath);
    }

    const archiveChecksum = checksums[posixRelative(staging, archivePath)]!;
    const snapshotId = createSnapshotId(
      `${region}-${compactTimestamp(new Date())}-${archiveChecksum.slice('sha256:'.length, 'sha256:'.length + 8)}`,
    );

    const style = buildStyleDocument({
      attribution: build.attribution,
      bounds: build.bounds,
      center: build.center,
      labelLanguages,
      maxZoom: build.maxZoom,
      minZoom: build.minZoom,
      name: `atlas-os ${region} basemap`,
      snapshotId,
    });
    const styleBytes = Buffer.from(`${JSON.stringify(style, null, 2)}\n`, 'utf8');
    const stylePath = join(basemapDirectory, STYLE_FILE);
    await writeFile(stylePath, styleBytes);
    checksums[posixRelative(staging, stylePath)] = sha256Bytes(styleBytes);

    let searchResult: Awaited<ReturnType<SearchPipeline['build']>> | undefined;
    if (search !== undefined) {
      const recorded = build.inputs.find((input) => input.kind === 'region_extract');
      const supplied = request.inputs.find((input) => input.kind === 'region_extract');
      const other = await store
        .readManifest(slot === 'blue' ? 'green' : 'blue')
        .catch(() => undefined);
      searchResult = await search.build({
        bounds: build.bounds,
        extract:
          recorded === undefined || supplied === undefined
            ? undefined
            : { bytes: recorded.bytes, checksum: recorded.checksum, path: supplied.path },
        forbiddenPaths: [store.dataRoot, ...request.inputs.map((input) => input.path)],
        otherImportDate:
          other === undefined ? undefined : searchComponentOf(other)?.engine.importDate,
        snapshotId,
        sourceTimestamp,
        staging,
      });
    }

    const artifactVersions = {
      [build.tool.name]: build.tool.version,
      schema: `${build.schema.name}@${build.schema.version}`,
    };
    const basemap = {
      archiveBytes: (await stat(archivePath)).size,
      attribution: build.attribution,
      bounds: build.bounds,
      glyphRanges: glyphRanges.map((artifact) => artifact.range),
      labelLanguages: [...labelLanguages],
      maxZoom: build.maxZoom,
      mediaType: 'application/vnd.pmtiles' as const,
      minZoom: build.minZoom,
      sourceLayers: [...build.sourceLayers],
      tileCount: summary.tileCount,
      vectorFormat: 'mvt' as const,
    };
    const source = { name: request.sourceName, timestamp: sourceTimestamp };

    // Basemap-only preparations keep writing exactly the schema-1 manifest they always wrote, so
    // nothing that reads them changes. A snapshot with search is schema 2.
    const manifest: SnapshotManifest =
      searchResult === undefined
        ? {
            activation: 'inactive',
            artifactVersions,
            basemap,
            checksums,
            components: { basemap: 'ready' },
            createdAt: new Date().toISOString(),
            inputs: [...build.inputs],
            region,
            schemaVersion: 1,
            snapshotId,
            source,
            validation: 'passed',
          }
        : {
            activation: 'inactive',
            artifactVersions,
            basemap,
            checksums: { ...checksums, ...searchResult.checksums },
            components: { basemap: 'ready', search: 'ready' },
            createdAt: new Date().toISOString(),
            inputs: [...build.inputs],
            region,
            schemaVersion: 2,
            search: searchResult.component,
            snapshotId,
            source,
            validation: 'passed',
          };

    await writeFile(join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    return snapshotId;
  }
}
