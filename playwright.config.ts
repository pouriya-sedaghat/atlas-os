import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end configuration.
 *
 * Two complete same-origin stacks run side by side: one backed by a host with a provisioned
 * basemap, and one backed by a host with no dataset at all. Both are the real applications —
 * the built Web bundle served by Vite's preview server, proxying to the real API process — so
 * the no-dataset path is exercised against a genuine backend rather than a stub.
 */
export const READY_ORIGIN = 'http://127.0.0.1:4173';
export const EMPTY_ORIGIN = 'http://127.0.0.1:4174';
/** A dataset with search, served by one private search host per slot. */
export const SEARCH_ORIGIN = 'http://127.0.0.1:4175';
/** The same dataset, with an API whose search hosts are not reachable yet. */
export const STARTING_ORIGIN = 'http://127.0.0.1:4176';
/** True when the real pinned engine runs behind the search hosts instead of the stand-in. */
export const REAL_ENGINE = (process.env['ATLAS_SEARCH_ENGINE_ARCHIVE'] ?? '') !== '';

const READY_API_PORT = '3210';
const EMPTY_API_PORT = '3211';
const SEARCH_API_PORT = '3212';
const STARTING_API_PORT = '3215';
const SEARCH_BLUE_PORT = '3213';
const SEARCH_GREEN_PORT = '3214';
const READY_DATA_ROOT = '.validation/e2e/ready';
const EMPTY_DATA_ROOT = '.validation/e2e/empty';
export const SEARCH_DATA_ROOT = '.validation/e2e/search';

/**
 * Some environments ship a Chromium build that does not match this Playwright release. Pointing
 * at it explicitly keeps the suite runnable there without downloading a second browser.
 */
const executablePath = process.env['ATLAS_E2E_CHROMIUM_PATH'];

function apiServer(port: string, dataRoot: string, search: Record<string, string> = {}) {
  return {
    command: `node apps/api/dist/index.js`,
    env: {
      ATLAS_API_HOST: '127.0.0.1',
      ATLAS_API_PORT: port,
      ATLAS_DATA_ROOT: dataRoot,
      ATLAS_LOG_LEVEL: 'warn',
      ATLAS_OFFLINE: 'true',
      ...search,
    },
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    timeout: 60_000,
    url: `http://127.0.0.1:${port}/health`,
  };
}

function webServer(previewPort: string, apiPort: string) {
  return {
    command: 'pnpm --filter @atlas-os/web exec vite preview',
    env: {
      ATLAS_WEB_API_TARGET: `http://127.0.0.1:${apiPort}`,
      ATLAS_WEB_PREVIEW_PORT: previewPort,
    },
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    timeout: 60_000,
    url: `http://127.0.0.1:${previewPort}/`,
  };
}

/** The production search host for one slot, with the real engine or the stand-in. */
function searchHost(slot: 'blue' | 'green', port: string) {
  return {
    command: 'pnpm exec tsx tests/e2e/start-search-host.ts',
    env: {
      E2E_SEARCH_DATA_ROOT: SEARCH_DATA_ROOT,
      E2E_SEARCH_HOST_PORT: port,
      E2E_SEARCH_SLOT: slot,
    },
    reuseExistingServer: false,
    // Playwright otherwise SIGKILLs the process group and the host cannot remove its work tree.
    gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 30_000 },
    stdout: 'pipe' as const,
    timeout: 60_000,
    url: `http://127.0.0.1:${port}/v1/status`,
  };
}

export default defineConfig({
  forbidOnly: process.env['CI'] !== undefined,
  fullyParallel: false,
  globalSetup: './tests/e2e/global-setup.ts',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
      },
    },
  ],
  reporter: [['list']],
  retries: 0,
  testDir: './tests/e2e',
  use: {
    baseURL: READY_ORIGIN,
    trace: 'retain-on-failure',
  },
  webServer: [
    apiServer(READY_API_PORT, READY_DATA_ROOT),
    apiServer(EMPTY_API_PORT, EMPTY_DATA_ROOT),
    searchHost('blue', SEARCH_BLUE_PORT),
    searchHost('green', SEARCH_GREEN_PORT),
    apiServer(SEARCH_API_PORT, SEARCH_DATA_ROOT, {
      ATLAS_SEARCH_ENGINE_BLUE_URL: `http://127.0.0.1:${SEARCH_BLUE_PORT}`,
      ATLAS_SEARCH_ENGINE_GREEN_URL: `http://127.0.0.1:${SEARCH_GREEN_PORT}`,
    }),
    // Port 9 (discard) never answers: this stack's search is truthfully still starting.
    apiServer(STARTING_API_PORT, SEARCH_DATA_ROOT, {
      ATLAS_SEARCH_ENGINE_BLUE_URL: 'http://127.0.0.1:9',
      ATLAS_SEARCH_ENGINE_GREEN_URL: 'http://127.0.0.1:9',
    }),
    webServer('4173', READY_API_PORT),
    webServer('4174', EMPTY_API_PORT),
    webServer('4175', SEARCH_API_PORT),
    webServer('4176', STARTING_API_PORT),
  ],
  workers: 1,
});
