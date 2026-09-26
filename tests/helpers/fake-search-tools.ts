import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SearchProbe } from '../../packages/atlas-os/src/snapshot.js';
import { syntheticDump } from '../../packages/atlas-os/src/internal/search/dump/synthetic.js';
import { selectProbesWithEngine } from '../../packages/atlas-os/src/internal/search/probes.js';
import type {
  ProbeSelection,
  SearchToolRunner,
  ToolIdentity,
} from '../../packages/atlas-os/src/internal/search/runner.js';
import { fakeEngineCommand } from './search-host.js';

interface DumpDocument {
  readonly object_type?: string;
  readonly object_id?: number;
  readonly osm_key?: string;
  readonly osm_value?: string;
  readonly address_type?: string;
  readonly name?: Record<string, string>;
  readonly housenumber?: string;
  readonly centroid: [number, number];
  readonly extra?: Record<string, string>;
}

/**
 * Stand-ins for the provisioning-only search tools, for machines without the engine runtime.
 *
 * The export writes the synthetic fixture in the production export shape. The import turns the
 * real post-processed dump, canary included, into the data the engine stand-in serves, and leaves
 * behind run-time output that records the staging path, as the real import does. Probe selection
 * is the production code, run against the engine stand-in.
 */
export class FakeSearchTools implements SearchToolRunner {
  readonly tools: readonly ToolIdentity[] = [
    { name: 'engine', version: 'test' },
    { name: 'database-builder', version: 'test' },
  ];
  readonly calls: string[] = [];
  /** Runs inside the export, before it returns; tests use it to change the extract. */
  onBuildDump: ((extract: string, workDirectory: string) => Promise<void>) | undefined;
  failImport = false;
  /** Serves no places at all, so no probe can be answered. */
  emptyIndex = false;

  async buildDump(options: { readonly extract: string; readonly workDirectory: string }) {
    this.calls.push('buildDump');
    await this.onBuildDump?.(options.extract, options.workDirectory);
    const dump = join(options.workDirectory, 'database', 'dump.jsonl');
    await mkdir(join(options.workDirectory, 'database'), { recursive: true });
    await writeFile(dump, syntheticDump());
    return { dump };
  }

  async importDump(options: {
    readonly dump: string;
    readonly engineDirectory: string;
    readonly workDirectory: string;
  }): Promise<void> {
    this.calls.push('importDump');
    if (this.failImport) throw new Error('import failed');
    const rows = (await readFile(options.dump, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; content: unknown });
    const header = rows[0]!.content as { data_timestamp: string };
    const documents = rows
      .filter((row) => row.type === 'Place')
      .flatMap((row) => row.content as DumpDocument[]);
    const canary = documents.find((document) => document.object_type === 'X')!;
    const places = this.emptyIndex
      ? []
      : documents
          .filter((document) => document.object_type !== 'X' && document.object_id !== undefined)
          .map((document) => ({
            coordinates: document.centroid,
            ...(document.housenumber === undefined ? {} : { housenumber: document.housenumber }),
            ...(document.extra === undefined ? {} : { extra: document.extra }),
            ...(document.name === undefined
              ? {}
              : {
                  names: {
                    en: document.name['name:en'] ?? document.name['name'],
                    fa: document.name['name:fa'] ?? document.name['name'],
                    ...(document.name['name:qaa'] === undefined
                      ? {}
                      : { qaa: document.name['name:qaa'] }),
                  },
                }),
            osm_id: document.object_id,
            osm_key: document.osm_key,
            osm_type: document.object_type,
            osm_value: document.osm_value,
            type: document.address_type ?? 'other',
          }));

    const node = join(options.engineDirectory, 'photon_data', 'node_1');
    await mkdir(join(node, 'data', 'nodes', '0'), { recursive: true });
    await mkdir(join(node, 'config'), { recursive: true });
    await mkdir(join(node, 'logs'), { recursive: true });
    await writeFile(join(node, 'config', 'opensearch.yml'), '#path.data: /path/to/data\n');
    await writeFile(join(node, 'logs', 'import.log'), `import into ${options.engineDirectory}\n`);
    await writeFile(
      join(node, 'data', 'fake-engine.json'),
      JSON.stringify({
        canary: { latitude: canary.centroid[1], longitude: canary.centroid[0] },
        generation: canary.extra!['atlas_generation'],
        importDate: header.data_timestamp,
        places,
      }),
    );
  }

  async selectProbes(options: ProbeSelection): Promise<SearchProbe[]> {
    this.calls.push('selectProbes');
    return selectProbesWithEngine({
      engineCommand: fakeEngineCommand,
      request: options,
      sealedEngine: options.sealedEngine,
      startupTimeoutMs: 20_000,
      workRoot: join(options.workDirectory, 'probe'),
    });
  }
}
