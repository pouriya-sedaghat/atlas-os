import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { FullConfig } from '@playwright/test';

/**
 * Prepares the two data roots the browser suite runs against: one with a validated, activated
 * basemap snapshot, and one deliberately left empty so the no-dataset path is exercised against
 * a real backend rather than a stubbed response.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // `rootDir` is the test directory; the repository root is where the config file lives, which
  // is also the working directory Playwright starts the web servers in.
  const root = config.configFile === undefined ? process.cwd() : dirname(config.configFile);

  const emptyRoot = resolve(root, '.validation/e2e/empty');
  await rm(emptyRoot, { force: true, recursive: true });
  await mkdir(emptyRoot, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/provision-fixture.mjs'), '.validation/e2e/ready'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error('Failed to provision the end-to-end basemap fixture.');
  }
}
