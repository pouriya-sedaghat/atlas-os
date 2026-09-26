import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { constants as osConstants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Owns each E2E work tree beyond the lifetime of Playwright's web-server children. */
async function main() {
  const root = resolve(import.meta.dirname, '..');
  const workRoot = await mkdtemp(join(tmpdir(), 'atlas-os-e2e-run-'));
  let child;
  let interrupted;
  let result = 1;
  const forward = (signal) => {
    interrupted ??= signal;
    child?.kill(signal);
  };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    child = spawn(
      process.execPath,
      [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)],
      {
        cwd: root,
        env: { ...process.env, ATLAS_E2E_RUN_ROOT: workRoot },
        stdio: 'inherit',
      },
    );
    const completed = await new Promise((done) => {
      child.once('error', (error) => done({ error }));
      child.once('exit', (code, signal) => done({ code, signal }));
    });
    if (completed.error !== undefined) {
      process.stderr.write(`Unable to start Playwright: ${completed.error.message}\n`);
    } else {
      result =
        completed.code ??
        (completed.signal === null ? 1 : 128 + (osConstants.signals[completed.signal] ?? 1));
    }
    if (interrupted !== undefined) result = interrupted === 'SIGINT' ? 130 : 143;
  } finally {
    try {
      await rm(workRoot, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`Unable to remove the E2E work tree: ${error.message}\n`);
      if (result === 0) result = 1;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }
  return result;
}

process.exitCode = await main();
