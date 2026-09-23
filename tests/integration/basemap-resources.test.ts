import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ApplicationService, loadConfig } from '@atlas-os/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApiServer } from '../../apps/api/src/server.js';
import {
  isLocalResourceUrl,
  styleAttributions,
  styleFetchedUrls,
} from '../../packages/atlas-os/src/internal/basemap/style.js';
import { createTestPlatform, installSnapshot, type TestPlatform } from '../helpers/snapshot.js';

function serverFor(context: TestPlatform) {
  const config = loadConfig({ ATLAS_DATA_ROOT: context.dataRoot });
  return buildApiServer(
    {
      config,
      service: new ApplicationService({
        atlas: context.platform.atlas,
        config,
        datasets: context.platform.datasets,
        resources: context.platform.resources,
      }),
    },
    { logger: false },
  );
}

describe('versioned basemap resources', () => {
  let context: TestPlatform;
  let server: ReturnType<typeof buildApiServer>;
  let snapshotId: string;
  let base: string;
  let archiveSize: number;

  beforeAll(async () => {
    context = await createTestPlatform();
    snapshotId = await installSnapshot(context.platform);
    server = serverFor(context);
    base = `/maps/v1/${snapshotId}`;
    const head = await server.inject({ method: 'HEAD', url: `${base}/basemap.pmtiles` });
    archiveSize = Number(head.headers['content-length']);
  });

  afterAll(async () => {
    await server.close();
    await context.cleanup();
  });

  it('serves the whole archive with range support advertised', async () => {
    const response = await server.inject({ method: 'GET', url: `${base}/basemap.pmtiles` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/vnd.pmtiles');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(Number(response.headers['content-length'])).toBe(archiveSize);
    expect(response.rawPayload.length).toBe(archiveSize);
    // Versioned URLs never change contents, so they may be cached indefinitely.
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers a HEAD request with the headers of the equivalent GET and no body', async () => {
    const response = await server.inject({ method: 'HEAD', url: `${base}/basemap.pmtiles` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/vnd.pmtiles');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(Number(response.headers['content-length'])).toBe(archiveSize);
    expect(response.rawPayload.length).toBe(0);
  });

  it('serves a byte range as 206 with a correct content range', async () => {
    const response = await server.inject({
      headers: { range: 'bytes=0-126' },
      method: 'GET',
      url: `${base}/basemap.pmtiles`,
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 0-126/${archiveSize}`);
    expect(Number(response.headers['content-length'])).toBe(127);
    expect(response.rawPayload.length).toBe(127);
    // The first seven bytes of the archive identify the format.
    expect(Buffer.from(response.rawPayload.subarray(0, 7)).toString('ascii')).toBe('PMTiles');
  });

  it('serves a suffix range and an open-ended range', async () => {
    const suffix = await server.inject({
      headers: { range: 'bytes=-16' },
      method: 'GET',
      url: `${base}/basemap.pmtiles`,
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.length).toBe(16);
    expect(suffix.headers['content-range']).toBe(
      `bytes ${archiveSize - 16}-${archiveSize - 1}/${archiveSize}`,
    );

    const openEnded = await server.inject({
      headers: { range: `bytes=${archiveSize - 32}-` },
      method: 'GET',
      url: `${base}/basemap.pmtiles`,
    });
    expect(openEnded.statusCode).toBe(206);
    expect(openEnded.rawPayload.length).toBe(32);
  });

  it('refuses an unsatisfiable range with 416 and a content range of the size', async () => {
    const response = await server.inject({
      headers: { range: `bytes=${archiveSize + 10}-${archiveSize + 20}` },
      method: 'GET',
      url: `${base}/basemap.pmtiles`,
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe(`bytes */${archiveSize}`);
    expect(response.json()).toMatchObject({ error: { code: 'RANGE_NOT_SATISFIABLE' } });
  });

  it('ignores a malformed range and serves the whole representation', async () => {
    const response = await server.inject({
      headers: { range: 'kilobytes=0-1' },
      method: 'GET',
      url: `${base}/basemap.pmtiles`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBe(archiveSize);
  });

  it.each([
    ['style.json', 'application/json; charset=utf-8'],
    ['sprite.json', 'application/json; charset=utf-8'],
    ['sprite@2x.json', 'application/json; charset=utf-8'],
    ['sprite.png', 'image/png'],
    ['sprite@2x.png', 'image/png'],
    ['glyphs/atlas-os-regular/0-255.pbf', 'application/x-protobuf'],
    ['glyphs/atlas-os-regular/1536-1791.pbf', 'application/x-protobuf'],
    ['glyphs/atlas-os-regular/65024-65279.pbf', 'application/x-protobuf'],
  ])('serves the local resource %s', async (resource, contentType) => {
    const response = await server.inject({ method: 'GET', url: `${base}/${resource}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(contentType);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves a style that fetches only local, snapshot-versioned resources', async () => {
    const response = await server.inject({ method: 'GET', url: `${base}/style.json` });
    const style = response.json() as Record<string, unknown>;

    expect(style['version']).toBe(8);
    expect(style['glyphs']).toBe(`${base}/glyphs/{fontstack}/{range}.pbf`);
    expect(style['sprite']).toBe(`${base}/sprite`);

    // The offline guarantee is about what the renderer fetches, not about every string in the
    // document: attribution is required to carry hyperlinks, and banning them outright would
    // force a choice between correct licensing and a meaningful offline guarantee.
    for (const url of styleFetchedUrls(style)) {
      expect(isLocalResourceUrl(url), `resource ${url} is not local`).toBe(true);
    }
  });

  it('serves a style whose attribution is present and carries its links', async () => {
    const response = await server.inject({ method: 'GET', url: `${base}/style.json` });
    const style = response.json() as Record<string, unknown>;
    const attributions = styleAttributions(style);

    expect(attributions.length).toBeGreaterThan(0);
    expect(attributions[0]!.length).toBeGreaterThan(0);
  });

  it('serves a sprite index describing the icons in the sheet', async () => {
    const response = await server.inject({ method: 'GET', url: `${base}/sprite.json` });
    const index = response.json() as Record<string, { width: number; pixelRatio: number }>;

    expect(Object.keys(index).length).toBeGreaterThan(0);
    for (const icon of Object.values(index)) {
      expect(icon.width).toBeGreaterThan(0);
      expect(icon.pixelRatio).toBe(1);
    }
  });

  it('serves a PNG sprite sheet with a real signature', async () => {
    const response = await server.inject({ method: 'GET', url: `${base}/sprite.png` });
    expect([...response.rawPayload.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

describe('basemap resource safety', () => {
  let context: TestPlatform;
  let server: ReturnType<typeof buildApiServer>;
  let snapshotId: string;

  beforeAll(async () => {
    context = await createTestPlatform();
    snapshotId = await installSnapshot(context.platform);
    server = serverFor(context);
  });

  afterAll(async () => {
    await server.close();
    await context.cleanup();
  });

  it.each([
    'basemap.pmtiles/../../../../etc/passwd',
    '..%2f..%2f..%2fetc%2fpasswd',
    '%2e%2e/%2e%2e/etc/passwd',
    'glyphs/atlas-os-regular/../../../manifest.json',
    'glyphs/%2e%2e/%2e%2e/manifest.json',
  ])('rejects the traversal attempt %s', async (attempt) => {
    const response = await server.inject({
      method: 'GET',
      url: `/maps/v1/${snapshotId}/${attempt}`,
    });

    expect([400, 404]).toContain(response.statusCode);
    expect(response.body).not.toContain('root:');
  });

  it('refuses a symbolic link that escapes the snapshot root', async () => {
    const secretDirectory = join(context.dataRoot, 'outside');
    await mkdir(secretDirectory, { recursive: true });
    await writeFile(join(secretDirectory, 'secret.json'), '{"secret":true}');
    const pointer = await context.platform.datasets.listSnapshots();
    expect(pointer[0]?.active).toBe(true);

    const slotBasemap = join(context.dataRoot, 'slots', 'blue', 'basemap');
    await symlink(join(secretDirectory, 'secret.json'), join(slotBasemap, 'style.json.link'));
    // The link is placed at an allowlisted name so only the containment check can stop it.
    await rm(join(slotBasemap, 'sprite.json'));
    await symlink(join(secretDirectory, 'secret.json'), join(slotBasemap, 'sprite.json'));

    const response = await server.inject({
      method: 'GET',
      url: `/maps/v1/${snapshotId}/sprite.json`,
    });

    expect([400, 404]).toContain(response.statusCode);
    expect(response.body).not.toContain('secret');
  });

  it('does not expose files that exist in the snapshot but are not allowlisted', async () => {
    for (const path of ['manifest.json', 'basemap/manifest.json', 'basemap/tool-work/x']) {
      const response = await server.inject({
        method: 'GET',
        url: `/maps/v1/${snapshotId}/${path}`,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('does not expose a snapshot that is not the active one', async () => {
    const other = await context.platform.datasets.prepareUpdate({
      inputs: [],
      sourceName: 'second',
    });
    expect(other).not.toBe(snapshotId);

    const response = await server.inject({ method: 'GET', url: `/maps/v1/${other}/style.json` });
    expect(response.statusCode).toBe(404);
  });

  it('leaks no absolute filesystem path in an error response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/maps/v1/${snapshotId}/../../etc/passwd`,
    });

    expect(response.body).not.toContain(context.dataRoot);
    expect(response.body).not.toContain('/tmp');
    expect(response.body).not.toContain('slots');
  });
});

describe('basemap resources without a dataset', () => {
  it('reports the feature as unavailable rather than failing', async () => {
    const context = await createTestPlatform();
    const server = serverFor(context);
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/maps/v1/iran-20260101t000000z-abcdef01/basemap.pmtiles',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'FEATURE_UNAVAILABLE' } });
    } finally {
      await server.close();
      await context.cleanup();
    }
  });
});
