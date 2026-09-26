import { chmod, lstat, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ENGINE_DATA_DIRECTORY,
  sealEngineTree,
} from '../../packages/atlas-os/src/internal/search/seal.js';
import { listTree } from '../../packages/atlas-os/src/internal/search/tree.js';

const directories: string[] = [];
const posix = process.platform !== 'win32';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

/**
 * Lays out a tree shaped like the engine's import output: one data directory holding a node with
 * configuration, index data, and the run-time log directory the import leaves behind.
 */
async function importedTree(): Promise<{ readonly staging: string; readonly engine: string }> {
  const staging = await mkdtemp(join(tmpdir(), 'atlas-os-seal-'));
  directories.push(staging);
  const engine = join(staging, 'search', 'engine');
  const node = join(engine, ENGINE_DATA_DIRECTORY, 'node_1');
  await mkdir(join(node, 'config'), { recursive: true });
  await mkdir(join(node, 'data', 'nodes', '0', '_state'), { recursive: true });
  await mkdir(join(node, 'logs'), { recursive: true });
  await mkdir(join(node, 'plugins'), { recursive: true });
  // Shipped configuration templates carry placeholder paths in comments; those are not host paths.
  await writeFile(join(node, 'config', 'opensearch.yml'), '#path.data: /path/to/data\n');
  await writeFile(join(node, 'data', 'nodes', '0', '_state', 'segments_1'), Buffer.from([1, 2, 3]));
  await writeFile(join(node, 'data', 'nodes', '0', 'node.lock'), '');
  await writeFile(join(node, 'logs', 'engine.log'), `started in ${staging}\n`);
  if (posix) {
    await chmod(join(node, 'config', 'opensearch.yml'), 0o600);
    await chmod(join(node, 'data'), 0o700);
  }
  return { engine, staging };
}

describe('search engine sealing', () => {
  it('removes run-time output, normalises modes and records every file', async () => {
    const { engine, staging } = await importedTree();
    const sealed = await sealEngineTree({ engineRoot: engine, forbiddenPaths: [staging] });

    await expect(lstat(join(engine, ENGINE_DATA_DIRECTORY, 'node_1', 'logs'))).rejects.toThrow();
    expect(Object.keys(sealed.checksums).sort()).toEqual([
      'search/engine/photon_data/node_1/config/opensearch.yml',
      'search/engine/photon_data/node_1/data/nodes/0/_state/segments_1',
      'search/engine/photon_data/node_1/data/nodes/0/node.lock',
    ]);
    expect(sealed.listing.files).toBe(3);
    expect(sealed.listing.bytes).toBe(Buffer.byteLength('#path.data: /path/to/data\n', 'utf8') + 3);
    if (posix) {
      for (const entry of sealed.listing.entries) {
        const mode = (await stat(join(engine, ...entry.path.split('/')))).mode & 0o7777;
        expect(mode).toBe(entry.type === 'directory' ? 0o755 : 0o644);
      }
    }
    // The digest is a pure function of the sealed tree.
    expect((await listTree(engine)).digest).toBe(sealed.listing.digest);
  });

  it('rejects any top-level entry other than the one data directory', async () => {
    const { engine, staging } = await importedTree();
    await writeFile(join(engine, 'stray.txt'), 'x');
    await expect(
      sealEngineTree({ engineRoot: engine, forbiddenPaths: [staging] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an import that produced no data directory', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'atlas-os-seal-'));
    directories.push(staging);
    await mkdir(join(staging, 'engine'));
    await expect(
      sealEngineTree({ engineRoot: join(staging, 'engine'), forbiddenPaths: [staging] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.skipIf(!posix)('rejects symbolic links', async () => {
    const { engine, staging } = await importedTree();
    await symlink('/etc/hostname', join(engine, ENGINE_DATA_DIRECTORY, 'node_1', 'link'));
    await expect(
      sealEngineTree({ engineRoot: engine, forbiddenPaths: [staging] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a text file that records a host path', async () => {
    const { engine, staging } = await importedTree();
    await writeFile(
      join(engine, ENGINE_DATA_DIRECTORY, 'node_1', 'config', 'jvm.options'),
      '-Djava.io.tmpdir=/tmp/engine\n',
    );
    await expect(
      sealEngineTree({ engineRoot: engine, forbiddenPaths: [staging] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a binary file that contains the staging directory', async () => {
    const { engine, staging } = await importedTree();
    await writeFile(
      join(engine, ENGINE_DATA_DIRECTORY, 'node_1', 'data', 'nodes', '0', '_state', 'state-0.st'),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(staging, 'utf8'), Buffer.from([3])]),
    );
    await expect(sealEngineTree({ engineRoot: engine, forbiddenPaths: [staging] })).rejects.toThrow(
      'records the directory it was built in',
    );
  });
});
