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

const READY_API_PORT = '3210';
const EMPTY_API_PORT = '3211';
const READY_DATA_ROOT = '.validation/e2e/ready';
const EMPTY_DATA_ROOT = '.validation/e2e/empty';

/**
 * Some environments ship a Chromium build that does not match this Playwright release. Pointing
 * at it explicitly keeps the suite runnable there without downloading a second browser.
 */
const executablePath = process.env['ATLAS_E2E_CHROMIUM_PATH'];

function apiServer(port: string, dataRoot: string) {
  return {
    command: `node apps/api/dist/index.js`,
    env: {
      ATLAS_API_HOST: '127.0.0.1',
      ATLAS_API_PORT: port,
      ATLAS_DATA_ROOT: dataRoot,
      ATLAS_LOG_LEVEL: 'warn',
      ATLAS_OFFLINE: 'true',
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
    webServer('4173', READY_API_PORT),
    webServer('4174', EMPTY_API_PORT),
  ],
  workers: 1,
});
