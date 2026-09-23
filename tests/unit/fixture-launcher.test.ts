import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  API_ENTRY,
  FIXTURE_DATA_ROOT,
  fixtureEnvironment,
  preflightProblem,
  usesFixtureDataRoot,
} from '../../scripts/fixture-api-environment.mjs';

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

/** A POSIX-only `NAME=value command` prefix, which PowerShell and Command Prompt reject. */
const INLINE_ASSIGNMENT = /^\s*[A-Z][A-Z0-9_]*=\S*\s+\S/m;

const ROOT = resolve('/srv/checkout');

describe('fixture API environment', () => {
  it('defaults to an absolute data root beneath the repository fixture directory', () => {
    const selected = fixtureEnvironment({}, ROOT);
    expect(isAbsolute(selected.ATLAS_DATA_ROOT)).toBe(true);
    expect(selected.ATLAS_DATA_ROOT).toBe(resolve(ROOT, '.validation', 'fixture-data'));
    expect(FIXTURE_DATA_ROOT).toBe('.validation/fixture-data');
  });

  it('keeps the active pointer beside the default data root', () => {
    const selected = fixtureEnvironment({}, ROOT);
    expect(selected.ATLAS_ACTIVE_SNAPSHOT_PATH).toBe(
      join(resolve(ROOT, '.validation', 'fixture-data'), 'active.json'),
    );
  });

  it('keeps an operator-supplied data root exactly as given', () => {
    for (const dataRoot of ['/var/lib/atlas', 'relative/data', 'C:\\atlas\\data']) {
      expect(fixtureEnvironment({ ATLAS_DATA_ROOT: dataRoot }, ROOT).ATLAS_DATA_ROOT).toBe(
        dataRoot,
      );
    }
  });

  it('keeps the active pointer beside an operator-supplied data root', () => {
    expect(
      fixtureEnvironment({ ATLAS_DATA_ROOT: '/var/lib/atlas' }, ROOT).ATLAS_ACTIVE_SNAPSHOT_PATH,
    ).toBe(join('/var/lib/atlas', 'active.json'));
  });

  it('keeps an operator-supplied active pointer exactly as given', () => {
    const selected = fixtureEnvironment(
      { ATLAS_ACTIVE_SNAPSHOT_PATH: '/elsewhere/pointer.json', ATLAS_DATA_ROOT: '/var/lib/atlas' },
      ROOT,
    );
    expect(selected).toEqual({
      ATLAS_ACTIVE_SNAPSHOT_PATH: '/elsewhere/pointer.json',
      ATLAS_DATA_ROOT: '/var/lib/atlas',
    });
  });

  it('treats an empty data root as unset', () => {
    // PowerShell and Command Prompt delete a variable set to nothing; only a POSIX shell leaves one
    // empty, and no data root can be empty.
    const environment = { ATLAS_ACTIVE_SNAPSHOT_PATH: '', ATLAS_DATA_ROOT: '' };
    expect(usesFixtureDataRoot(environment)).toBe(true);
    expect(fixtureEnvironment(environment, ROOT).ATLAS_DATA_ROOT).toBe(
      resolve(ROOT, '.validation', 'fixture-data'),
    );
  });

  it('reports whether the fixture data root is in use', () => {
    expect(usesFixtureDataRoot({})).toBe(true);
    expect(usesFixtureDataRoot({ ATLAS_DATA_ROOT: '/var/lib/atlas' })).toBe(false);
  });

  it('returns only the data-root variables and leaves the input untouched', () => {
    const environment = { ATLAS_API_PORT: '3100', SECRET_TOKEN: 'do-not-copy' };
    const selected = fixtureEnvironment(environment, ROOT);
    expect(Object.keys(selected).sort()).toEqual(['ATLAS_ACTIVE_SNAPSHOT_PATH', 'ATLAS_DATA_ROOT']);
    expect(environment).toEqual({ ATLAS_API_PORT: '3100', SECRET_TOKEN: 'do-not-copy' });
  });
});

describe('fixture API preflight', () => {
  const apiEntry = resolve(ROOT, API_ENTRY);
  const dataRoot = resolve(ROOT, FIXTURE_DATA_ROOT);
  const pointer = join(dataRoot, 'active.json');
  const existing =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  it('starts when the build and the activated fixture are both present', () => {
    expect(
      preflightProblem({
        apiEntry,
        dataRoot,
        exists: existing(apiEntry, pointer),
        usingFixture: true,
      }),
    ).toBeNull();
  });

  it('asks for a build before anything else', () => {
    expect(preflightProblem({ apiEntry, dataRoot, exists: existing(), usingFixture: true })).toBe(
      'The API has not been built. Run `pnpm build`, then try again.',
    );
  });

  it('asks for the fixture when the build exists but nothing is activated', () => {
    expect(
      preflightProblem({ apiEntry, dataRoot, exists: existing(apiEntry), usingFixture: true }),
    ).toBe(
      'The developer fixture has not been provisioned. Run `pnpm basemap:fixture`, then try again.',
    );
  });

  it('does not send an operator with their own data root to the fixture command', () => {
    const problem = preflightProblem({
      apiEntry,
      dataRoot: '/var/lib/atlas',
      exists: existing(apiEntry),
      usingFixture: false,
    });
    expect(problem).toContain('ATLAS_DATA_ROOT has no activated snapshot');
    expect(problem).not.toContain('basemap:fixture');
  });

  it('names what to run and never a path', () => {
    const problems = [
      preflightProblem({ apiEntry, dataRoot, exists: existing(), usingFixture: true }),
      preflightProblem({ apiEntry, dataRoot, exists: existing(apiEntry), usingFixture: true }),
      preflightProblem({ apiEntry, dataRoot, exists: existing(apiEntry), usingFixture: false }),
    ];
    for (const problem of problems) {
      expect(problem).not.toContain(ROOT);
      expect(problem).not.toMatch(/[/\\]/);
    }
  });
});

describe('cross-platform fixture quick start', () => {
  it('exposes the documented command from the root package', () => {
    const manifest = JSON.parse(repositoryFile('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['api:start:fixture']).toBe('node scripts/start-fixture-api.mjs');
  });

  it('documents the quick start as exactly the four shell-neutral commands', () => {
    const readme = repositoryFile('README.md');
    const section = readme.slice(readme.indexOf('## Quick start'));
    const block = /```\w*\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
    expect(block.split('\n').filter((line) => line.trim() !== '')).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'pnpm basemap:fixture',
      'pnpm api:start:fixture',
    ]);
  });

  it('documents the developer fixture with the shell-neutral command', () => {
    const development = repositoryFile('docs/development.md');
    const start = development.indexOf('### Developer fixture');
    const section = development.slice(start, development.indexOf('\n### ', start + 1));
    expect(section).toContain('pnpm api:start:fixture');
    expect(section).not.toMatch(INLINE_ASSIGNMENT);
  });

  it('starts the API without a shell, a child process or a network request', () => {
    for (const path of ['scripts/start-fixture-api.mjs', 'scripts/fixture-api-environment.mjs']) {
      const source = repositoryFile(path);
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const specifier of specifiers) {
        expect(['node:fs', 'node:path', 'node:url', './fixture-api-environment.mjs']).toContain(
          specifier,
        );
      }
      expect(source).not.toMatch(/\b(?:spawn|spawnSync|exec|execSync|execFile|fork|fetch)\s*\(/);
    }
  });

  it('uses no POSIX-only inline assignment anywhere in either guide', () => {
    for (const path of ['README.md', 'docs/development.md']) {
      expect(repositoryFile(path), path).not.toMatch(INLINE_ASSIGNMENT);
    }
  });
});
