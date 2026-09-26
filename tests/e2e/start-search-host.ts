import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { engineServeCommand } from '../../packages/atlas-os/src/internal/search/host/engine.js';
import { SearchEngineHost } from '../../packages/atlas-os/src/internal/search/host/host.js';
import { SnapshotStore } from '../../packages/atlas-os/src/internal/snapshot/store.js';
import { fakeEngineCommand, freePort } from '../helpers/search-host.js';

/**
 * Runs the production search host for one slot of the browser suite's search data root.
 *
 * The engine is the real pinned engine when `ATLAS_SEARCH_ENGINE_ARCHIVE` is set, otherwise the
 * engine stand-in. Configuration arrives through the environment Playwright sets, so the command
 * is the same in every shell.
 */
async function main(): Promise<void> {
  const dataRoot = resolve(process.env['E2E_SEARCH_DATA_ROOT'] ?? '.validation/e2e/search');
  const slot = process.env['E2E_SEARCH_SLOT'] === 'green' ? 'green' : 'blue';
  const port = Number(process.env['E2E_SEARCH_HOST_PORT'] ?? '3213');
  const archive = process.env['ATLAS_SEARCH_ENGINE_ARCHIVE'];

  const runRoot = process.env['ATLAS_E2E_RUN_ROOT'];
  if (
    runRoot === undefined ||
    dirname(resolve(runRoot)) !== resolve(tmpdir()) ||
    !basename(runRoot).startsWith('atlas-os-e2e-run-')
  ) {
    throw new Error('Start the browser suite with `pnpm test:e2e`.');
  }
  const workRoot = join(runRoot, slot);
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  const host = new SearchEngineHost({
    config: {
      engineArchive: archive || '/unused/engine.jar',
      enginePort: await freePort(),
      fenceMs: 0,
      heap: '512m',
      javaExecutable: process.env['ATLAS_SEARCH_ENGINE_JAVA'] || 'java',
      listenAddress: '127.0.0.1',
      listenPort: port,
      pollMs: 250,
      queryTimeoutMs: 5_000,
      reserveBytes: 0,
      retryMs: 1_000,
      slot,
      startupTimeoutMs: 180_000,
      workRoot,
    },
    engineCommand:
      archive === undefined || archive === ''
        ? fakeEngineCommand
        : engineServeCommand({
            engineArchive: archive,
            heap: '512m',
            javaExecutable: process.env['ATLAS_SEARCH_ENGINE_JAVA'] || 'java',
          }),
    log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    region: 'iran',
    store: new SnapshotStore(dataRoot),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void host
        .close()
        .then(() => rm(workRoot, { force: true, recursive: true }))
        .then(() => process.exit(0));
    });
  }
  await host.start();
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
