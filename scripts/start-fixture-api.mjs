import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  API_ENTRY,
  fixtureEnvironment,
  preflightProblem,
  usesFixtureDataRoot,
} from './fixture-api-environment.mjs';

/**
 * Starts the compiled API against the developer fixture, from any shell.
 *
 * `NAME=value command` is POSIX shell syntax, which PowerShell and Command Prompt reject. It was
 * also wrong where it did run: `pnpm --filter @atlas-os/api start` runs from `apps/api`, so a
 * relative data root resolved beneath that package and the API reported no basemap installed.
 * This sets an absolute data root itself, then runs the API in this same process, so its signal
 * handling and exit status are exactly its own. It spawns no shell and makes no network request.
 *
 * Usage: pnpm api:start:fixture
 */
const repositoryRoot = resolve(import.meta.dirname, '..');
const apiEntry = resolve(repositoryRoot, API_ENTRY);
const usingFixture = usesFixtureDataRoot(process.env);
const selected = fixtureEnvironment(process.env, repositoryRoot);

const problem = preflightProblem({
  apiEntry,
  // Resolved as the API's own configuration resolves it, so the check inspects the same place.
  dataRoot: resolve(process.cwd(), selected.ATLAS_DATA_ROOT),
  exists: existsSync,
  usingFixture,
});

if (problem === null) {
  Object.assign(process.env, selected);
  await import(pathToFileURL(apiEntry).href);
} else {
  process.stderr.write(`${problem}\n`);
  process.exitCode = 1;
}
