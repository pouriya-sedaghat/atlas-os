import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Provisions a deterministic basemap snapshot into a data root, using the same command-line
 * tool an operator uses in production. Only the tile builder differs: this generates a synthetic
 * fixture rather than consuming an OpenStreetMap extract, so the script needs no download, no
 * external tool and no network.
 *
 * Usage: node scripts/provision-fixture.mjs <data-root> [--keep]
 */
const root = resolve(import.meta.dirname, '..');
const [target, ...flags] = process.argv.slice(2);

if (target === undefined) {
  process.stderr.write('Usage: node scripts/provision-fixture.mjs <data-root> [--keep]\n');
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
cli(['update', 'activate', snapshotId]);

process.stdout.write(`${JSON.stringify({ dataRoot, ok: true, snapshotId }, null, 2)}\n`);
