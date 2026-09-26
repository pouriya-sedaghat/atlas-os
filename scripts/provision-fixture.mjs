import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Provisions a deterministic basemap snapshot into a data root, using the same command-line
 * tool an operator uses in production. Only the tile builder differs: this generates a synthetic
 * fixture rather than consuming an OpenStreetMap extract, so the script needs no download, no
 * external tool and no network.
 *
 * With `--search`, the snapshot also carries the synthetic search fixture, imported and proved
 * by the real search engine. That needs the engine: by default the local search images, or with
 * `--search-mode local --engine-archive <path>` a local Java runtime and the pinned archive.
 * No search engine is running while this script activates, so it activates with the explicitly
 * named override; the API reports search as starting until the engine host has loaded it.
 *
 * Usage: node scripts/provision-fixture.mjs <data-root> [--keep] [--search]
 *          [--search-mode container|local] [--engine-archive <path>]
 */
const root = resolve(import.meta.dirname, '..');
const [target, ...flags] = process.argv.slice(2);
const USAGE =
  'Usage: node scripts/provision-fixture.mjs <data-root> [--keep] [--search] ' +
  '[--search-mode container|local] [--engine-archive <path>]\n';

if (target === undefined) {
  process.stderr.write(USAGE);
  process.exit(64);
}

function flagValue(name) {
  const index = flags.indexOf(name);
  if (index === -1) return undefined;
  const value = flags[index + 1];
  if (value === undefined || value.startsWith('--')) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  return value;
}

const withSearch = flags.includes('--search');
const searchMode = flagValue('--search-mode') ?? 'container';
const engineArchive = flagValue('--engine-archive');
if (!['container', 'local'].includes(searchMode)) {
  process.stderr.write(USAGE);
  process.exit(64);
}

const dataRoot = resolve(root, target);
if (!flags.includes('--keep')) {
  await rm(dataRoot, { force: true, recursive: true });
}
await mkdir(dataRoot, { recursive: true });

const environment = {
  ...process.env,
  ATLAS_DATA_ROOT: dataRoot,
  ATLAS_REGION: process.env.ATLAS_REGION ?? 'iran',
  // Selects the generated development fixture. This is the platform's own tooling
  // configuration, not an application-facing option: no command-line flag selects a builder.
  ATLAS_TILE_TOOL_KIND: 'synthetic',
  ...(withSearch
    ? {
        ATLAS_SEARCH_TOOL_KIND: 'synthetic',
        ATLAS_SEARCH_TOOL_MODE: searchMode,
        ...(engineArchive === undefined
          ? {}
          : { ATLAS_SEARCH_ENGINE_ARCHIVE: resolve(process.cwd(), engineArchive) }),
      }
    : {}),
};

function cli(args) {
  const result = spawnSync(process.execPath, [resolve(root, 'apps/cli/dist/index.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  });
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error(`atlas-os ${args.join(' ')} failed with exit code ${result.status}.`);
  }
  return JSON.parse(result.stdout);
}

const prepared = cli(['update', 'prepare', '--source-name', 'synthetic-fixture']);
const snapshotId = prepared.prepared;
const validated = cli(['update', 'validate', snapshotId]);
if (validated.report.valid !== true) {
  throw new Error('Fixture snapshot did not validate.');
}
cli([
  'update',
  'activate',
  snapshotId,
  ...(withSearch ? ['--activate-while-search-starting'] : []),
]);

process.stdout.write(`${JSON.stringify({ dataRoot, ok: true, snapshotId }, null, 2)}\n`);
