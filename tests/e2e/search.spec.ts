import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, test, type Page, type Request } from '@playwright/test';

import {
  READY_ORIGIN,
  REAL_ENGINE,
  SEARCH_DATA_ROOT,
  SEARCH_ORIGIN,
  STARTING_ORIGIN,
} from '../../playwright.config.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const TEHRAN = 'osm:node:8000000000000001';
const LIBRARY = 'osm:node:8000000000000010';
const ARABIC_KAF = String.fromCodePoint(0x0643);

function external(page: Page): Request[] {
  const found: Request[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (!LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''))) found.push(request);
  });
  return found;
}

function searchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/search') seen.push(url.searchParams.get('q') ?? '');
  });
  return seen;
}

/** Waits until the stack's search engine serves the active snapshot. */
async function searchReady(page: Page, origin: string): Promise<string> {
  let snapshot = '';
  await expect
    .poll(
      async () => {
        const dataset = (await (await page.request.get(`${origin}/api/v1/dataset`)).json()) as {
          search?: { state?: string; snapshotId?: string };
        };
        snapshot = dataset.search?.snapshotId ?? '';
        return dataset.search?.state;
      },
      { intervals: [250], timeout: 180_000 },
    )
    .toBe('ready');
  return snapshot;
}

async function openMap(page: Page, origin: string): Promise<void> {
  await page.goto(origin);
  await expect(page.getByTestId('map-status')).toHaveText('ready', { timeout: 30_000 });
}

test.describe('place search', () => {
  test('autocompletes Persian from the keyboard and marks the chosen place', async ({ page }) => {
    const externalRequests = external(page);
    await searchReady(page, SEARCH_ORIGIN);
    await openMap(page, SEARCH_ORIGIN);

    const input = page.getByRole('combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveAttribute('dir', 'auto');
    await input.focus();
    await page.keyboard.type('تهر', { delay: 30 });

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = listbox.getByRole('option');
    await expect(options.first()).toHaveAttribute('data-place-id', TEHRAN);
    await expect(page.getByTestId('search-status')).toContainText('یافت شد');
    await expect(page.getByTestId('search-attribution')).toBeVisible();

    // Keyboard navigation moves the active option and keeps the combobox in sync.
    const firstId = await options.first().getAttribute('id');
    await expect(input).toHaveAttribute('aria-activedescendant', firstId!);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', firstId!);

    await page.keyboard.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(input).toHaveValue('تهران');
    const marker = page.getByTestId('place-marker');
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute('role', 'img');
    await expect(marker).toHaveAttribute('aria-label', 'تهران');

    // Escape closes, then clears.
    await input.focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');

    expect(externalRequests.map((request) => request.url())).toEqual([]);
  });

  test('meets Arabic letter variants at the Persian spelling', async ({ page }) => {
    const externalRequests = external(page);
    await searchReady(page, SEARCH_ORIGIN);
    await openMap(page, SEARCH_ORIGIN);
    await page.getByRole('combobox').fill(`${ARABIC_KAF}تابخانه`);
    await expect(page.getByRole('option').first()).toHaveAttribute('data-place-id', LIBRARY);
    expect(externalRequests).toEqual([]);
  });

  test('waits for a pause and two letters before asking, and only once', async ({ page }) => {
    const queries = searchRequests(page);
    await searchReady(page, SEARCH_ORIGIN);
    await openMap(page, SEARCH_ORIGIN);
    const input = page.getByRole('combobox');

    await input.focus();
    await page.keyboard.type('ت');
    await page.waitForTimeout(500);
    expect(queries).toEqual([]);

    await page.keyboard.type('هران', { delay: 20 });
    await expect(page.getByRole('option').first()).toBeVisible();
    expect(queries).toEqual(['تهران']);
  });

  test('describes the map centre and a picked point only when asked', async ({ page }) => {
    const externalRequests = external(page);
    const reverse: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/reverse') reverse.push(request.url());
    });
    await searchReady(page, SEARCH_ORIGIN);
    await openMap(page, SEARCH_ORIGIN);

    // Choosing a place moves the map there; nothing is described until asked.
    await page.getByRole('combobox').fill('تهران');
    await page.getByRole('option').first().click();
    const map = page.getByTestId('map-container');
    await expect(map).toHaveAttribute('data-camera', 'idle', { timeout: 30_000 });
    expect(reverse).toEqual([]);

    await page.getByTestId('reverse-centre').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reverse-result').locator('[data-place-id]')).toHaveAttribute(
      'data-place-id',
      TEHRAN,
    );
    expect(reverse).toHaveLength(1);

    // Pick mode is explicit and turns itself off after one point.
    const pick = page.getByTestId('reverse-pick');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');
    await expect(map).toHaveAttribute('data-picking', 'true');
    // Off the centre, so the click lands on the map rather than on the marker.
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40);
    await expect.poll(() => reverse.length).toBe(2);
    await expect(pick).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByTestId('reverse-result').getByTestId('search-attribution'),
    ).toContainText('Synthetic development fixture');
    expect(externalRequests).toEqual([]);
  });

  test('disables search where the dataset has none', async ({ page }) => {
    await openMap(page, READY_ORIGIN);
    await expect(page.getByRole('combobox')).toBeDisabled();
    await expect(page.getByTestId('search-status')).toContainText('نصب نشده');
    await expect(page.getByTestId('reverse-centre')).toBeDisabled();
  });

  test('says truthfully that search is starting', async ({ page }) => {
    const externalRequests = external(page);
    await openMap(page, STARTING_ORIGIN);
    const input = page.getByRole('combobox');
    await expect(input).toBeEnabled();
    await input.fill('تهران');
    await expect(page.getByTestId('search-status')).toContainText('آماده');
    await expect(page.getByRole('listbox')).toBeHidden();
    expect(externalRequests).toEqual([]);
  });

  test('drops an answer from another snapshot and moves to the new one', async ({ page }) => {
    test.skip(
      REAL_ENGINE,
      'The embedded engine binds fixed loopback ports, so only one real engine runs per machine.',
    );
    const externalRequests = external(page);
    const first = await searchReady(page, SEARCH_ORIGIN);
    await openMap(page, SEARCH_ORIGIN);
    await expect(page.getByTestId('map-meta')).toContainText(first);

    // An operator prepares and activates the next snapshot while the page is open.
    const next = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/e2e/provision-search.ts'), SEARCH_DATA_ROOT, '--next'],
      { encoding: 'utf8' },
    );
    expect(next.status, next.stderr).toBe(0);
    const second = (JSON.parse(next.stdout) as { snapshotId: string }).snapshotId;
    await expect.poll(() => searchReady(page, SEARCH_ORIGIN), { timeout: 180_000 }).toBe(second);

    // The page still draws the first snapshot, so the first answer from the second is dropped
    // and the basemap is read again; the next query is then answered against the new map.
    await page.getByRole('combobox').fill('تهران');
    await expect(page.getByTestId('map-meta')).toContainText(second, { timeout: 30_000 });
    await expect(page.getByTestId('map-status')).toHaveText('ready', { timeout: 30_000 });
    await page.getByRole('combobox').fill('تهرا');
    await page.getByRole('combobox').fill('تهران');
    await expect(page.getByRole('option').first()).toHaveAttribute('data-place-id', TEHRAN);
    expect(externalRequests).toEqual([]);
  });
});
