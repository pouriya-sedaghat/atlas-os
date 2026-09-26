import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function checkout() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-e2e-runner-test-'));
  roots.push(root);
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'node_modules', '@playwright', 'test'), { recursive: true });
  await copyFile(resolve('scripts/test-e2e.mjs'), join(root, 'scripts', 'test-e2e.mjs'));
  await writeFile(
    join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    `const {mkdir,writeFile} = require('node:fs/promises');
const {join} = require('node:path');
(async () => {
  const workRoot = process.env.ATLAS_E2E_RUN_ROOT;
  await mkdir(join(workRoot,'blue'),{recursive:true});
  await writeFile(join(workRoot,'blue','engine-data'),'synthetic data');
  await writeFile(join(process.cwd(),'record.json'), JSON.stringify({workRoot, args:process.argv.slice(2)}));
  if (process.env.STUB_MODE === 'interrupt') setInterval(() => {}, 1000);
  else process.exitCode = process.env.STUB_MODE === 'fail' ? 7 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });\n`,
  );
  return root;
}

async function record(root: string): Promise<{ workRoot: string; args: string[] }> {
  return JSON.parse(await readFile(join(root, 'record.json'), 'utf8')) as {
    workRoot: string;
    args: string[];
  };
}

describe('browser-suite work tree lifecycle', () => {
  it('removes the child work tree after success and passes Playwright arguments through', async () => {
    const root = await checkout();
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/test-e2e.mjs'), '--grep', 'map'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    const started = await record(root);
    expect(result.status).toBe(0);
    expect(started.args).toEqual(['test', '--grep', 'map']);
    await expect(readFile(join(started.workRoot, 'blue', 'engine-data'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes the child work tree even when the browser suite exits with failure', async () => {
    const root = await checkout();
    const result = spawnSync(process.execPath, [join(root, 'scripts/test-e2e.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STUB_MODE: 'fail' },
      timeout: 10_000,
    });
    expect(result.status).toBe(7);
    const started = await record(root);
    await expect(readFile(started.workRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'removes the tree when the parent is interrupted',
    async () => {
      const root = await checkout();
      const child = spawn(process.execPath, [join(root, 'scripts/test-e2e.mjs')], {
        cwd: root,
        env: { ...process.env, STUB_MODE: 'interrupt' },
        stdio: 'ignore',
      });
      try {
        const started = await new Promise<Awaited<ReturnType<typeof record>>>((done, reject) => {
          const deadline = setTimeout(() => reject(new Error('E2E child did not start')), 5_000);
          const check = async () => {
            try {
              const value = await record(root);
              clearTimeout(deadline);
              done(value);
            } catch {
              setTimeout(() => void check(), 20);
            }
          };
          void check();
        });
        child.kill('SIGTERM');
        const status = await new Promise<number | null>((done) => child.once('exit', done));
        expect(status).toBe(143);
        await expect(readFile(started.workRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
  );
});
