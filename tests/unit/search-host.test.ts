import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSearchHostConfig } from '../../packages/atlas-os/src/internal/search/host/config.js';
import {
  InsufficientSpaceError,
  copySealedTree,
  planSpace,
} from '../../packages/atlas-os/src/internal/search/host/copy.js';
import { engineServeCommand } from '../../packages/atlas-os/src/internal/search/host/engine.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-os-host-'));
  roots.push(root);
  return root;
}

describe('search host configuration', () => {
  it('needs only a slot, and defaults everything else to the host image', () => {
    expect(readSearchHostConfig({ ATLAS_SEARCH_SLOT: 'green' })).toEqual({
      engineArchive: '/opt/atlas-os/engine/engine.jar',
      enginePort: 2321,
      fenceMs: 0,
      heap: '1g',
      javaExecutable: 'java',
      listenAddress: '0.0.0.0',
      listenPort: 2322,
      pollMs: 1000,
      queryTimeoutMs: 1900,
      reserveBytes: 268_435_456,
      retryMs: 30_000,
      slot: 'green',
      startupTimeoutMs: 300_000,
      workRoot: '/var/lib/atlas-engine',
    });
  });

  it.each([
    [{ ATLAS_SEARCH_SLOT: undefined }, 'ATLAS_SEARCH_SLOT'],
    [{ ATLAS_SEARCH_SLOT: 'red' }, 'ATLAS_SEARCH_SLOT'],
    [{ ATLAS_SEARCH_ENGINE_HEAP: '1 g' }, 'ATLAS_SEARCH_ENGINE_HEAP'],
    [{ ATLAS_SEARCH_ENGINE_HEAP: '0g' }, 'ATLAS_SEARCH_ENGINE_HEAP'],
    [{ ATLAS_SEARCH_WORK_ROOT: 'relative/work' }, 'ATLAS_SEARCH_WORK_ROOT'],
    [{ ATLAS_SEARCH_ENGINE_ARCHIVE: 'engine.jar' }, 'ATLAS_SEARCH_ENGINE_ARCHIVE'],
    [{ ATLAS_SEARCH_HOST_PORT: '70000' }, 'ATLAS_SEARCH_HOST_PORT'],
    [{ ATLAS_SEARCH_HOST_PORT: '2321' }, 'ATLAS_SEARCH_ENGINE_PORT'],
    [{ ATLAS_SEARCH_HOST_FENCE_MS: '-1' }, 'ATLAS_SEARCH_HOST_FENCE_MS'],
    [{ ATLAS_SEARCH_HOST_RESERVE_BYTES: '1e9' }, 'ATLAS_SEARCH_HOST_RESERVE_BYTES'],
    [{ ATLAS_SEARCH_ENGINE_JAVA: 'java -Dx=y' }, 'ATLAS_SEARCH_ENGINE_JAVA'],
    [{ ATLAS_SEARCH_HOST_ADDRESS: 'example.invalid' }, 'ATLAS_SEARCH_HOST_ADDRESS'],
  ] as const)('rejects %j', (overrides, variable) => {
    const environment = { ATLAS_SEARCH_SLOT: 'blue', ...overrides };
    expect(() => readSearchHostConfig(environment)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', details: { variable } }),
    );
  });

  it('starts the engine on loopback with bounded results and no optional surfaces', () => {
    const command = engineServeCommand({
      engineArchive: '/opt/atlas-os/engine/engine.jar',
      heap: '768m',
      javaExecutable: '/opt/java/bin/java',
    })({
      dataDirectory: '/work/trees/x',
      homeDirectory: '/work/home',
      port: 2321,
      temporaryDirectory: '/work/tmp',
    });
    expect(command.executable).toBe('/opt/java/bin/java');
    expect(command.args).toEqual([
      '-Xmx768m',
      '-XX:+ExitOnOutOfMemoryError',
      '-Duser.home=/work/home',
      '-Djava.io.tmpdir=/work/tmp',
      '-jar',
      '/opt/atlas-os/engine/engine.jar',
      'serve',
      '-data-dir',
      '/work/trees/x',
      '-listen-ip',
      '127.0.0.1',
      '-listen-port',
      '2321',
      '-max-results',
      '20',
      '-max-reverse-results',
      '5',
      '-query-timeout',
      '2',
    ]);
    const joined = command.args.join(' ');
    for (const forbidden of ['cors', 'update', 'metrics', 'synonym', '0.0.0.0']) {
      expect(joined).not.toContain(forbidden);
    }
  });
});

describe('working copy space planning', () => {
  it('counts the tree, per-entry allocation and the reserve, and nothing region-specific', () => {
    const plan = planSpace({
      availableBytes: 10_000,
      blockSize: 4096,
      reserveBytes: 100,
      tree: { bytes: 1000, directories: 1, files: 1 },
    });
    expect(plan).toEqual({ availableBytes: 10_000, requiredBytes: 9292, sufficient: true });
    expect(
      planSpace({
        availableBytes: 9291,
        blockSize: 4096,
        reserveBytes: 100,
        tree: { bytes: 1000, directories: 1, files: 1 },
      }).sufficient,
    ).toBe(false);
  });
});

describe('transactional working copy', () => {
  async function sealedSource(root: string): Promise<string> {
    const source = join(root, 'sealed');
    await mkdir(join(source, 'photon_data', 'node_1'), { recursive: true });
    await writeFile(join(source, 'photon_data', 'node_1', 'segments_1'), 'segments');
    return source;
  }

  it('copies, verifies against the seal and publishes by rename', async () => {
    const root = await scratch();
    const source = await sealedSource(root);
    const expected = await listTree(source);
    const work = join(root, 'work');
    await mkdir(work);
    const result = await copySealedTree({
      expected: { ...expected, treeDigest: expected.digest },
      name: 'load-1',
      reserveBytes: 0,
      source,
      workRoot: work,
    });
    expect(result.path).toBe(join(work, 'trees', 'load-1'));
    expect(['clone', 'copy']).toContain(result.method);
    expect((await listTree(result.path)).digest).toBe(expected.digest);
    expect(await readdir(join(work, 'incoming'))).toEqual([]);
  });

  it('discards a copy that does not match the seal', async () => {
    const root = await scratch();
    const source = await sealedSource(root);
    const expected = await listTree(source);
    const work = join(root, 'work');
    await mkdir(work);
    await expect(
      copySealedTree({
        afterCopy: (path) => writeFile(join(path, 'photon_data', 'extra'), 'x'),
        expected: { ...expected, treeDigest: expected.digest },
        name: 'load-1',
        reserveBytes: 0,
        source,
        workRoot: work,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await readdir(join(work, 'incoming'))).toEqual([]);
    expect(await readdir(join(work, 'trees'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('refuses a source containing a link', async () => {
    const root = await scratch();
    const source = await sealedSource(root);
    const expected = await listTree(source);
    await symlink('/etc/hostname', join(source, 'photon_data', 'link'));
    const work = join(root, 'work');
    await mkdir(work);
    await expect(
      copySealedTree({
        expected: { ...expected, treeDigest: expected.digest },
        name: 'load-1',
        reserveBytes: 0,
        source,
        workRoot: work,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('plans against the space left beside every copy already kept, and never frees it', async () => {
    const root = await scratch();
    const source = await sealedSource(root);
    const expected = await listTree(source);
    const work = join(root, 'work');
    await mkdir(join(work, 'trees', 'kept'), { recursive: true });
    await writeFile(join(work, 'trees', 'kept', 'segments_1'), 'resident');
    const entries = expected.files + expected.directories;
    const required = expected.bytes + entries * 4096 + 10;
    const attempt = (availableBytes: number) =>
      copySealedTree({
        cloneFile: async () => {
          throw Object.assign(new Error('clone unsupported'), { code: 'EOPNOTSUPP' });
        },
        expected: { ...expected, treeDigest: expected.digest },
        measureSpace: async () => ({ availableBytes, blockSize: 4096 }),
        name: `load-${availableBytes}`,
        reserveBytes: 10,
        source,
        workRoot: work,
      });

    const refused = await attempt(required - 1).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(InsufficientSpaceError);
    expect((refused as InsufficientSpaceError).plan).toEqual({
      availableBytes: required - 1,
      requiredBytes: required,
      sufficient: false,
    });
    // The copy already kept is untouched, and the refused copy left nothing behind.
    expect((await readdir(join(work, 'trees'))).sort()).toEqual(['kept']);
    expect(await readdir(join(work, 'incoming'))).toEqual([]);

    const accepted = await attempt(required);
    expect(accepted.method).toBe('copy');
    expect((await readdir(join(work, 'trees'))).sort()).toEqual(['kept', `load-${required}`]);
  });

  it('fails as insufficient space when only a full copy is possible and it would not fit', async () => {
    const root = await scratch();
    const source = await sealedSource(root);
    const expected = await listTree(source);
    const work = join(root, 'work');
    await mkdir(work);
    const attempt = copySealedTree({
      expected: { ...expected, treeDigest: expected.digest },
      name: 'load-1',
      reserveBytes: Number.MAX_SAFE_INTEGER,
      source,
      workRoot: work,
    });
    // On a filesystem that clones extents the copy needs no space and succeeds.
    const outcome = await attempt.then(
      (result) => result.method,
      (error: unknown) => error,
    );
    if (outcome === 'clone') return;
    expect(outcome).toBeInstanceOf(InsufficientSpaceError);
    expect(await readdir(join(work, 'trees'))).toEqual([]);
  });
});
