import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import { EMPTY_ORIGIN, READY_ORIGIN } from '../../playwright.config.js';

/** Hosts a browser may contact in a correctly configured offline deployment. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLocalRequest(request: Request): boolean {
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  return LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''));
}

interface RequestLog {
  readonly all: Request[];
  readonly external: Request[];
}

function recordRequests(page: Page): RequestLog {
  const log: RequestLog = { all: [], external: [] };
  page.on('request', (request) => {
    log.all.push(request);
    if (!isLocalRequest(request)) log.external.push(request);
  });
  return log;
}

function externalUrls(log: RequestLog): string[] {
  return log.external.map((request) => request.url());
}

async function waitForMapReady(page: Page): Promise<Locator> {
  await expect(page.getByTestId('map-section')).toBeVisible();
  await expect(page.getByTestId('map-status')).toHaveText('ready', { timeout: 30_000 });
  return page.getByTestId('map-container');
}

test.describe('basemap rendering', () => {
  test('renders the active vector basemap from local resources only', async ({ page }) => {
    const log = recordRequests(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(READY_ORIGIN);
    await waitForMapReady(page);

    // The renderer created a real, sized canvas.
    const canvas = page.locator('.map-canvas canvas.maplibregl-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(200);

    // The descriptor the application rendered from describes vector tiles in an archive.
    await expect(page.getByTestId('map-meta')).toContainText('MVT');
    await expect(page.getByTestId('map-meta')).toContainText('application/vnd.pmtiles');

    // Tiles were fetched from the archive as byte ranges rather than as whole files.
    const archiveRequests = log.all.filter(
      (request) => request.url().includes('/maps/v1/') && request.url().endsWith('.pmtiles'),
    );
    expect(archiveRequests.length).toBeGreaterThan(0);
    const ranged = archiveRequests.filter((request) =>
      (request.headers()['range'] ?? '').startsWith('bytes='),
    );
    expect(
      ranged.length,
      `archive requests: ${archiveRequests.map((r) => r.headers()['range'] ?? 'no-range').join(' | ')}`,
    ).toBeGreaterThan(0);

    // Style, sprite and the right-to-left shaping plugin all came from this origin.
    const urls = log.all.map((request) => request.url());
    expect(urls.some((url) => url.includes('/maps/v1/') && url.endsWith('/style.json'))).toBe(true);
    expect(urls.some((url) => url.includes('/maps/v1/') && url.includes('/sprite'))).toBe(true);
    expect(urls.some((url) => url.includes('/vendor/mapbox-gl-rtl-text.js'))).toBe(true);

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    expect(externalUrls(log), 'the browser must not contact a non-local origin').toEqual([]);
  });

  test('shows the basemap attribution without fetching anything for it', async ({ page }) => {
    const log = recordRequests(page);
    await page.goto(READY_ORIGIN);
    await waitForMapReady(page);

    // Attribution is a licence obligation, so it must be visible rather than hidden behind a
    // control the viewer has to open.
    const attribution = page.locator('.maplibregl-ctrl-attrib');
    await expect(attribution).toBeVisible();

    const declared = await page.evaluate(async () => {
      const response = await fetch('/api/v1/basemap');
      const descriptor = (await response.json()) as { attribution?: string };
      return descriptor.attribution ?? '';
    });
    expect(declared.length).toBeGreaterThan(0);

    // Whatever the active snapshot declares is what the control shows.
    const shown = (await attribution.textContent()) ?? '';
    const withoutMarkup = declared
      .replaceAll(/<[^>]+>/g, '')
      .replaceAll(/&[a-z]+;/g, '')
      .trim();
    for (const fragment of withoutMarkup.split(/\s{2,}/).filter((part) => part.length > 3)) {
      expect(shown, `attribution is missing: ${fragment}`).toContain(fragment.trim());
    }

    // Any link the attribution carries is navigational: it is rendered as an anchor and is
    // never requested while the map renders.
    const anchors = await attribution.locator('a[href^="http"]').all();
    for (const anchor of anchors) {
      const href = await anchor.getAttribute('href');
      expect(log.all.map((request) => request.url())).not.toContain(href);
    }
    expect(externalUrls(log), 'the browser must not contact a non-local origin').toEqual([]);
  });

  test('draws features from the vector layers the style declares', async ({ page }) => {
    await page.goto(READY_ORIGIN);
    const container = await waitForMapReady(page);

    // The application reports which layers produced geometry at the current view. Asserting on
    // that is deterministic, and a failure names the layers that did render.
    await expect(page.getByTestId('map-rendered-layers')).toBeVisible({ timeout: 30_000 });
    const rendered = (await container.getAttribute('data-rendered-layers')) ?? '';
    const layers = rendered.split(',').filter((entry) => entry.length > 0);

    expect(layers.length, `rendered layers: ${rendered}`).toBeGreaterThan(0);
    expect(layers, `rendered layers: ${rendered}`).toContain('place-label');
    expect(
      layers.some((layer) => ['water', 'transportation', 'boundary'].includes(layer)),
      `rendered layers: ${rendered}`,
    ).toBe(true);
  });

  test('loads Persian and English label configuration', async ({ page }) => {
    const log = recordRequests(page);
    await page.goto(READY_ORIGIN);
    const container = await waitForMapReady(page);

    await expect(page.getByTestId('language-fa')).toHaveAttribute('aria-pressed', 'true');
    await expect(container).toHaveAttribute('data-label-language', 'fa');

    const glyphUrls = log.all
      .map((request) => request.url())
      .filter((url) => url.includes('/glyphs/atlas-os-regular/'));
    expect(glyphUrls.length, 'no glyph range was requested').toBeGreaterThan(0);

    // The right-to-left plugin is served from this origin, never from a plugin host.
    expect(
      log.all
        .map((request) => request.url())
        .some((url) => url.endsWith('/vendor/mapbox-gl-rtl-text.js')),
      'the local right-to-left plugin asset was not requested',
    ).toBe(true);

    // Shaping is what proves the plugin actually ran: the plugin rewrites Persian text into
    // Arabic Presentation Forms before the renderer looks a glyph up, so the range holding those
    // shaped characters must be fetched. The base Arabic block is what unshaped text would
    // request, so it must not satisfy this on its own.
    const presentationForms = glyphUrls.filter((url) => url.endsWith('/65024-65279.pbf'));
    const baseArabicOnly = glyphUrls.filter((url) => url.endsWith('/1536-1791.pbf'));
    expect(
      presentationForms.length,
      `Arabic Presentation Forms range was not requested; glyph ranges seen: ${glyphUrls
        .map((url) => url.slice(url.lastIndexOf('/') + 1))
        .join(', ')}`,
    ).toBeGreaterThan(0);
    expect(
      presentationForms.length > 0 || baseArabicOnly.length === 0,
      'the base Arabic range alone cannot satisfy the shaping assertion',
    ).toBe(true);

    await page.getByTestId('language-en').click();
    await expect(page.getByTestId('language-en')).toHaveAttribute('aria-pressed', 'true');
    await expect(container).toHaveAttribute('data-label-language', 'en');
    await expect(page.getByTestId('map-status')).toHaveText('ready');

    expect(externalUrls(log)).toEqual([]);
  });

  test('stays usable and does not crash when no dataset is installed', async ({ page }) => {
    const log = recordRequests(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(EMPTY_ORIGIN);

    await expect(page.getByTestId('basemap-unavailable')).toBeVisible();
    await expect(page.getByTestId('map-section')).toHaveCount(0);
    // Operational status stays available, which is what keeps a host without a dataset useful.
    await expect(page.getByTestId('capabilities-summary')).toBeVisible();
    await expect(page.getByTestId('capabilities-summary')).toContainText('basemap');

    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(externalUrls(log)).toEqual([]);
  });
});
