import { access, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { GeographicBounds } from '../../contracts.js';
import { PlatformError } from '../../errors.js';
import type { SearchComponent } from '../../snapshot.js';
import { checksumsMatch, sha256File } from '../fs/checksum.js';
import { appendCanary, postProcessDump } from './dump/postprocess.js';
import { writeSyntheticDump } from './dump/synthetic.js';
import { engineImportInstant, generationMarker } from './marker.js';
import type { SearchToolRunner } from './runner.js';
import { ENGINE_ROOT, sealEngineTree } from './seal.js';

/** Where the generation canary lives: outside every public region, at the edge of the globe. */
export const CANARY_COORDINATE = { latitude: -89.5, longitude: -179.5 } as const;

/** The database builder writes this before starting PostgreSQL and removes it only after stop. */
export async function searchClusterMayBeRunning(staging: string): Promise<boolean> {
  try {
    await access(join(staging, 'search-work', 'database', 'cluster-unverified'));
    return true;
  } catch (error) {
    // If the marker cannot be read, do not risk deleting a possibly live cluster's files.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

const OSM_ATTRIBUTION = {
  licence: 'ODbL-1.0',
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
} as const;

const SYNTHETIC_ATTRIBUTION = {
  licence: 'none',
  text: 'Synthetic development fixture — not map data',
  url: null,
} as const;

/** The regional extract as the basemap build recorded it, plus where it is on this host. */
export interface ExtractProvenance {
  readonly path: string;
  readonly checksum: string;
  readonly bytes: number;
}

export interface SearchBuildRequest {
  /** The staging snapshot root; the engine tree is written to `search/engine` inside it. */
  readonly staging: string;
  readonly snapshotId: string;
  readonly bounds: GeographicBounds;
  readonly sourceTimestamp: string;
  /** Required for a regional build; absent for the synthetic fixture. */
  readonly extract: ExtractProvenance | undefined;
  /** Host paths that must never appear in the sealed engine tree. */
  readonly forbiddenPaths: readonly string[];
  /** The import instant of the generation in the other slot, which this one must differ from. */
  readonly otherImportDate: string | undefined;
}

export interface SearchBuildResult {
  readonly component: SearchComponent;
  readonly checksums: Readonly<Record<string, string>>;
}

/**
 * Builds a snapshot's search component from the same source as its basemap.
 *
 * Export, post-process, bind to a generation, import, seal, and prove: the freshly sealed database
 * is started on a disposable copy and asked the probes it will be asked on every future load.
 * Everything happens inside the staging tree. Ordinary failures discard the staging directory;
 * when stopping the database cannot be confirmed, the private staging tree remains for recovery.
 */
export class SearchPipeline {
  readonly #kind: 'external' | 'synthetic';
  readonly #runner: SearchToolRunner;
  readonly #clock: () => Date;

  constructor(options: {
    readonly kind: 'external' | 'synthetic';
    readonly runner: SearchToolRunner;
    readonly clock?: () => Date;
  }) {
    this.#kind = options.kind;
    this.#runner = options.runner;
    this.#clock = options.clock ?? (() => new Date());
  }

  get kind(): 'external' | 'synthetic' {
    return this.#kind;
  }

  async build(request: SearchBuildRequest): Promise<SearchBuildResult> {
    const work = join(request.staging, 'search-work');
    const engineDirectory = join(request.staging, ...ENGINE_ROOT.split('/'));
    await mkdir(work, { recursive: true });
    try {
      // 1. The raw export, from the extract the basemap was built from, or the synthetic fixture.
      let raw: string;
      let source: SearchComponent['source'];
      if (this.#kind === 'external') {
        const extract = request.extract;
        if (extract === undefined) {
          throw new PlatformError('INVALID_REQUEST', 'Search needs the regional extract.', {
            details: { requiredInput: 'region_extract' },
          });
        }
        raw = (await this.#runner.buildDump({ extract: extract.path, workDirectory: work })).dump;
        source = { bytes: extract.bytes, checksum: extract.checksum, kind: 'region_extract' };
      } else {
        raw = join(work, 'synthetic.jsonl');
        const synthetic = await writeSyntheticDump(raw);
        source = { checksum: synthetic.checksum, kind: 'synthetic' };
      }

      // 2. A unique import instant, bound into the dump the engine imports.
      const importDate = uniqueInstant(this.#clock(), request.otherImportDate);
      const dump = join(work, 'dump.jsonl');
      const processed = await postProcessDump({
        bounds: request.bounds,
        engineImportDate: importDate,
        input: raw,
        output: dump,
      });
      const marker = generationMarker({
        dumpChecksum: processed.sha256,
        engineImportDate: importDate,
        snapshotId: request.snapshotId,
        sourceChecksum: source.checksum,
        sourceTimestamp: request.sourceTimestamp,
      });
      await appendCanary(dump, { coordinate: CANARY_COORDINATE, marker });

      // 3. Import and seal.
      await this.#runner.importDump({ dump, engineDirectory, workDirectory: work });
      const sealed = await sealEngineTree({
        engineRoot: engineDirectory,
        forbiddenPaths: [request.staging, work, ...request.forbiddenPaths],
      });
      // Every builder has now read the extract: the basemap tool, the database export and, through
      // the dump, the import. It must still be exactly the bytes the basemap build hashed.
      if (request.extract !== undefined) await assertUnchanged(request.extract);

      const expected = {
        bytes: sealed.listing.bytes,
        directories: sealed.listing.directories,
        files: sealed.listing.files,
        treeDigest: sealed.listing.digest,
      };

      // 4. Prove the sealed database, and record what it answers.
      const probes = await this.#runner.selectProbes({
        bounds: request.bounds,
        candidates: processed.candidates,
        canary: CANARY_COORDINATE,
        expected,
        importDate,
        marker,
        sealedEngine: engineDirectory,
        workDirectory: work,
      });

      return {
        checksums: sealed.checksums,
        component: {
          attribution: this.#kind === 'external' ? OSM_ATTRIBUTION : SYNTHETIC_ATTRIBUTION,
          canary: { coordinate: CANARY_COORDINATE, objectId: 0, objectType: 'X' },
          dump: {
            bytes: processed.bytes,
            documents: processed.documents,
            places: processed.places,
            sha256: processed.sha256,
            variants: { ...processed.variants },
          },
          engine: { ...expected, importDate, root: ENGINE_ROOT },
          generationMarker: marker,
          languages: ['fa', 'en'],
          probes,
          source,
          tools: this.#runner.tools.map((tool) => ({ ...tool })),
        },
      };
    } finally {
      if (!(await searchClusterMayBeRunning(request.staging))) {
        await rm(work, { force: true, recursive: true });
      }
    }
  }
}

/**
 * Re-reads the extract after every builder has run. The basemap build hashed it before its tool
 * started, so an unchanged digest here proves all of them read the same bytes.
 */
async function assertUnchanged(extract: ExtractProvenance): Promise<void> {
  const details = await stat(extract.path).catch(() => undefined);
  const checksum = details === undefined ? undefined : await sha256File(extract.path);
  if (
    details === undefined ||
    details.size !== extract.bytes ||
    checksum === undefined ||
    !checksumsMatch(extract.checksum, checksum)
  ) {
    throw new PlatformError('CONFLICT', 'The regional extract changed during preparation.', {
      details: { requiredInput: 'region_extract' },
    });
  }
}

/** An instant that differs from the other slot's, so their engines are never mistaken. */
function uniqueInstant(now: Date, other: string | undefined): string {
  const candidate = engineImportInstant(now);
  if (other !== undefined && Date.parse(other) === Date.parse(candidate)) {
    return engineImportInstant(new Date(now.getTime() + 1));
  }
  return candidate;
}
