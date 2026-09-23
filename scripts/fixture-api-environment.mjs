import { join, resolve } from 'node:path';

/**
 * Decisions behind `pnpm api:start:fixture`, kept free of side effects so they can be tested
 * without starting a server.
 */

/** Where `pnpm basemap:fixture` provisions, relative to the repository root. */
export const FIXTURE_DATA_ROOT = '.validation/fixture-data';

/** The compiled API entry, relative to the repository root. */
export const API_ENTRY = 'apps/api/dist/index.js';

/** The pointer file the platform reads from a data root to find the active snapshot. */
const ACTIVE_POINTER_FILE = 'active.json';

/**
 * Whether a variable carries a value.
 *
 * An empty value is treated as absent: PowerShell and Command Prompt remove a variable when it is
 * set to nothing, so only a POSIX shell can produce one, and no data root can be empty.
 */
function supplied(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Whether the data root comes from the operator rather than defaulting to the fixture. */
export function usesFixtureDataRoot(environment) {
  return !supplied(environment.ATLAS_DATA_ROOT);
}

/**
 * The data-root variables the API should start with.
 *
 * Anything the operator already set is kept exactly as given. Only what is missing is filled in:
 * the data root, made absolute so the working directory cannot change what it names, and the
 * active-pointer path, kept beside whichever data root is in effect.
 */
export function fixtureEnvironment(environment, repositoryRoot) {
  const dataRoot = supplied(environment.ATLAS_DATA_ROOT)
    ? environment.ATLAS_DATA_ROOT
    : resolve(repositoryRoot, FIXTURE_DATA_ROOT);
  const activeSnapshotPath = supplied(environment.ATLAS_ACTIVE_SNAPSHOT_PATH)
    ? environment.ATLAS_ACTIVE_SNAPSHOT_PATH
    : join(dataRoot, ACTIVE_POINTER_FILE);
  return { ATLAS_ACTIVE_SNAPSHOT_PATH: activeSnapshotPath, ATLAS_DATA_ROOT: dataRoot };
}

/**
 * Why the API cannot start against the fixture yet, as a message an operator can act on, or
 * `null` when it can.
 *
 * The build is checked first because nothing else matters without it. Messages name the command
 * to run and nothing else: no path, no environment value and no stack trace.
 */
export function preflightProblem({ apiEntry, dataRoot, exists, usingFixture }) {
  if (!exists(apiEntry)) {
    return 'The API has not been built. Run `pnpm build`, then try again.';
  }
  if (!exists(join(dataRoot, ACTIVE_POINTER_FILE))) {
    return usingFixture
      ? 'The developer fixture has not been provisioned. Run `pnpm basemap:fixture`, then try again.'
      : 'ATLAS_DATA_ROOT has no activated snapshot. Activate one there, or unset it to use the fixture.';
  }
  return null;
}
