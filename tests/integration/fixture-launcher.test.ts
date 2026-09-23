import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER_FILES = ['start-fixture-api.mjs', 'fixture-api-environment.mjs'];

/**
 * Stands in for the compiled API: reports what it was started with, then exits. It uses no module
 * syntax, so it loads the same way whether Node treats it as CommonJS or as an ES module.
 */
const STUB_API = `process.stdout.write(JSON.stringify({
  activeSnapshotPath: process.env.ATLAS_ACTIVE_SNAPSHOT_PATH,
  dataRoot: process.env.ATLAS_DATA_ROOT,
  entry: process.argv[1],
}));
`;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

/**
 * A disposable copy of the repository layout the launcher depends on. It never touches the real
 * build or fixture, so these tests run the same on a fresh checkout as after a build.
 */
async function checkout(options: { built?: boolean; provisioned?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-launcher-')));
  directories.push(root);
  await mkdir(join(root, 'scripts'));
  for (const file of LAUNCHER_FILES) {
    await copyFile(resolve('scripts', file), join(root, 'scripts', file));
  }
  if (options.built === true) {
    await mkdir(join(root, 'apps', 'api', 'dist'), { recursive: true });
    await writeFile(join(root, 'apps', 'api', 'dist', 'index.js'), STUB_API);
  }
  if (options.provisioned === true) await activate(join(root, '.validation', 'fixture-data'));
  return root;
}

async function activate(dataRoot: string) {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, 'active.json'), '{}');
}

/** The inherited environment without any `ATLAS_*` value from the machine running the tests. */
function cleanEnvironment(overrides: Record<string, string> = {}) {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('ATLAS_')) environment[key] = value;
  }
  return { ...environment, ...overrides };
}

function launch(root: string, cwd: string, environment = cleanEnvironment()) {
  // Node itself, never a shell, so nothing here depends on the platform's shell syntax.
  return spawnSync(process.execPath, [join(root, 'scripts', 'start-fixture-api.mjs')], {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
}

describe('pnpm api:start:fixture', () => {
  it('refuses to start without a build, naming the command to run', async () => {
    const root = await checkout({ provisioned: true });
    const result = launch(root, root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('The API has not been built. Run `pnpm build`, then try again.\n');
  });

  it('refuses to start before the fixture is provisioned, naming the command to run', async () => {
    const root = await checkout({ built: true });
    const result = launch(root, root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'The developer fixture has not been provisioned. Run `pnpm basemap:fixture`, then try again.\n',
    );
  });

  it('prints no stack trace and no path for an expected preflight failure', async () => {
    for (const root of [await checkout(), await checkout({ built: true })]) {
      const { stderr } = launch(root, root);
      expect(stderr).not.toMatch(/^\s+at /m);
      expect(stderr).not.toContain('Error');
      expect(stderr).not.toContain(root);
    }
  });

  it('runs the API in its own process with an absolute fixture data root', async () => {
    const root = await checkout({ built: true, provisioned: true });
    const result = launch(root, root);

    expect(result.status).toBe(0);
    const started = JSON.parse(result.stdout) as Record<string, string>;
    const dataRoot = join(root, '.validation', 'fixture-data');
    expect(started.dataRoot).toBe(dataRoot);
    expect(started.activeSnapshotPath).toBe(join(dataRoot, 'active.json'));
    // The launcher is still the running script: the API was imported, not spawned as a child.
    expect(started.entry).toBe(join(root, 'scripts', 'start-fixture-api.mjs'));
  });

  it('finds the fixture from any working directory', async () => {
    // pnpm runs a package's script from that package's directory; a relative data root would
    // then name a different place, which is how the documented command broke even on POSIX.
    const root = await checkout({ built: true, provisioned: true });
    const elsewhere = join(root, 'apps', 'api');
    const result = launch(root, elsewhere);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).dataRoot).toBe(join(root, '.validation', 'fixture-data'));
  });

  it('keeps an operator-supplied data root and pointer', async () => {
    const root = await checkout({ built: true });
    const dataRoot = join(root, 'operator-data');
    await activate(dataRoot);
    const result = launch(
      root,
      root,
      cleanEnvironment({
        ATLAS_ACTIVE_SNAPSHOT_PATH: join(dataRoot, 'pointer.json'),
        ATLAS_DATA_ROOT: dataRoot,
      }),
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      activeSnapshotPath: join(dataRoot, 'pointer.json'),
      dataRoot,
    });
  });

  it('does not send an operator with an empty data root of their own to the fixture', async () => {
    const root = await checkout({ built: true });
    const result = launch(root, root, cleanEnvironment({ ATLAS_DATA_ROOT: join(root, 'empty') }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ATLAS_DATA_ROOT has no activated snapshot');
    expect(result.stderr).not.toContain('basemap:fixture');
  });
});
