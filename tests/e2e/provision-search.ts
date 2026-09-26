import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SyntheticTileBuilder } from '../../packages/atlas-os/src/internal/builders/synthetic.js';
import { SearchPipeline } from '../../packages/atlas-os/src/internal/search/pipeline.js';
import { LocalSearchToolRunner } from '../../packages/atlas-os/src/internal/search/runner.js';
import { readSearchToolConfig } from '../../packages/atlas-os/src/internal/search/tools.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { BasemapProvisioner } from '../../packages/atlas-os/src/provisioning.js';
import { FakeSearchTools } from '../helpers/fake-search-tools.js';

/**
 * Prepares and activates a snapshot with the synthetic search fixture for the browser suite,
 * through the production provisioner: post-processing, canary, import, sealing, probe selection,
 * validation, promotion and activation.
 *
 * With `ATLAS_SEARCH_ENGINE_ARCHIVE` set, the real pinned engine imports and proves the data; the
 * host then runs the same engine. Without it, the engine stand-in does both, so the suite runs on
 * any machine. `--next` prepares a second snapshot into the other slot and activates it.
 *
 * Usage: tsx tests/e2e/provision-search.ts <data-root> [--next]
 */
/** The same region, languages and font the basemap fixture uses; paths from the repository root. */
const REGION_BOUNDS = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 } as const;
const LABEL_LANGUAGES = ['fa', 'en'] as const;
const FONT_PATH = resolve('assets/fonts/Vazirmatn-Regular.ttf');

async function main(): Promise<void> {
  const [target, flag] = process.argv.slice(2);
  if (target === undefined) {
    process.stderr.write('Usage: tsx tests/e2e/provision-search.ts <data-root> [--next]\n');
    process.exit(64);
  }
  const dataRoot = resolve(target);
  const archive = process.env['ATLAS_SEARCH_ENGINE_ARCHIVE'];

  if (flag !== '--next') {
    await rm(dataRoot, { force: true, recursive: true });
    await mkdir(dataRoot, { recursive: true });
  }

  const runner =
    archive === undefined || archive === ''
      ? new FakeSearchTools()
      : new LocalSearchToolRunner(
          readSearchToolConfig(
            {
              ATLAS_SEARCH_BUILD_THREADS: '2',
              ATLAS_SEARCH_ENGINE_ARCHIVE: archive,
              ATLAS_SEARCH_IMPORT_HEAP: '512m',
              ATLAS_SEARCH_TOOL_KIND: 'synthetic',
              ATLAS_SEARCH_TOOL_MODE: 'local',
            },
            'synthetic',
          ),
        );

  const provisioner = new BasemapProvisioner({
    bounds: REGION_BOUNDS,
    builder: new SyntheticTileBuilder(),
    fontPath: FONT_PATH,
    labelLanguages: [...LABEL_LANGUAGES],
    region: 'iran',
    search: new SearchPipeline({ kind: 'synthetic', runner }),
    store: new SnapshotStore(dataRoot),
  });

  const snapshotId = await provisioner.prepare({ inputs: [], sourceName: 'e2e-search-fixture' });
  await provisioner.activate(snapshotId);
  process.stdout.write(`${JSON.stringify({ snapshotId })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
