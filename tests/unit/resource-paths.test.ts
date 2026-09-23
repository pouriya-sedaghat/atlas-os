import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PlatformError } from '@atlas-os/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decodePathSegment,
  decodeRelativePath,
  isWithinRoot,
  resolveWithinRoot,
} from '../../packages/atlas-os/src/internal/fs/paths.js';
import { resolveBasemapResource } from '../../packages/atlas-os/src/internal/basemap/resources.js';

describe('path segment decoding', () => {
  it('accepts ordinary resource names', () => {
    expect(decodePathSegment('basemap.pmtiles')).toBe('basemap.pmtiles');
    expect(decodePathSegment('sprite%402x.json')).toBe('sprite@2x.json');
    expect(decodeRelativePath('/glyphs/atlas-os-regular/0-255.pbf')).toEqual([
      'glyphs',
      'atlas-os-regular',
      '0-255.pbf',
    ]);
  });

  it.each([
    ['..'],
    ['.'],
    [''],
    ['%2e%2e'],
    ['%2f'],
    ['%2F'],
    ['%5c'],
    ['a\u0000b'],
    ['a\\b'],
    ['%zz'],
  ])('rejects the traversal or control segment %s', (segment) => {
    expect(() => decodePathSegment(segment)).toThrow(PlatformError);
  });

  it('rejects traversal anywhere in a multi-segment path', () => {
    expect(() => decodeRelativePath('glyphs/../../../etc/passwd')).toThrow(PlatformError);
    expect(() => decodeRelativePath('glyphs/%2e%2e/secret')).toThrow(PlatformError);
  });
});

describe('root containment', () => {
  it('recognises paths inside and outside a root', () => {
    expect(isWithinRoot('/data/slots/blue', '/data/slots/blue/basemap/x.pmtiles')).toBe(true);
    expect(isWithinRoot('/data/slots/blue', '/data/slots/blue')).toBe(true);
    expect(isWithinRoot('/data/slots/blue', '/data/slots/green/x')).toBe(false);
    // A sibling whose name merely starts with the root's name is not inside it.
    expect(isWithinRoot('/data/slots/blue', '/data/slots/blue-old/x')).toBe(false);
  });
});

describe('symbolic link containment', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), 'atlas-paths-'));
    root = join(base, 'snapshot');
    outside = join(base, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, 'real.pbf'), 'inside');
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.pbf'));
    await symlink(join(root, 'real.pbf'), join(root, 'inside-link.pbf'));
  });

  afterAll(async () => {
    await rm(join(root, '..'), { force: true, recursive: true });
  });

  it('resolves a genuine file inside the root', async () => {
    await expect(resolveWithinRoot(root, ['real.pbf'])).resolves.toContain('real.pbf');
  });

  it('allows a symbolic link that stays inside the root', async () => {
    await expect(resolveWithinRoot(root, ['inside-link.pbf'])).resolves.toContain('real.pbf');
  });

  it('refuses a symbolic link that escapes the root', async () => {
    await expect(resolveWithinRoot(root, ['escape.pbf'])).rejects.toThrow(/symbolic link escapes/i);
  });

  it('reports a missing file rather than leaking the attempted path', async () => {
    await expect(resolveWithinRoot(root, ['absent.pbf'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('resource allowlist', () => {
  const snapshot = 'iran-20260101t000000z-abcdef01';

  it.each([
    ['basemap.pmtiles', 'application/vnd.pmtiles'],
    ['style.json', 'application/json; charset=utf-8'],
    ['sprite.json', 'application/json; charset=utf-8'],
    ['sprite@2x.json', 'application/json; charset=utf-8'],
    ['sprite.png', 'image/png'],
    ['sprite@2x.png', 'image/png'],
    ['glyphs/atlas-os-regular/0-255.pbf', 'application/x-protobuf'],
    ['glyphs/atlas-os-regular/65024-65279.pbf', 'application/x-protobuf'],
  ])('serves %s', (resource, contentType) => {
    const resolved = resolveBasemapResource(`v1/${snapshot}/${resource}`);
    expect(resolved).toMatchObject({ contentType, snapshotId: snapshot });
    expect(resolved.segments[0]).toBe('basemap');
  });

  it.each([
    ['v1/' + snapshot + '/manifest.json'],
    ['v1/' + snapshot + '/basemap/basemap.pmtiles'],
    ['v1/' + snapshot + '/glyphs/other-font/0-255.pbf'],
    ['v1/' + snapshot + '/glyphs/atlas-os-regular/0-100.pbf'],
    ['v1/' + snapshot + '/glyphs/atlas-os-regular/1-256.pbf'],
    ['v1/' + snapshot + '/glyphs/atlas-os-regular/0-255.txt'],
    ['v2/' + snapshot + '/style.json'],
    ['v1/NOT-A-SNAPSHOT/style.json'],
    ['v1/' + snapshot],
    ['v1/' + snapshot + '/sprite'],
  ])('refuses the unlisted resource %s', (path) => {
    expect(() => resolveBasemapResource(path)).toThrow(PlatformError);
  });
});
