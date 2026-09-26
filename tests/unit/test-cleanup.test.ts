import type { SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { cleanUp, removeContainer } from '../helpers/cleanup.js';

function result(status: number, stderr = ''): SpawnSyncReturns<string> {
  return { output: [], pid: 1, signal: null, status, stderr, stdout: '' };
}

describe('engine test cleanup', () => {
  it('removes a container by name and fails when the client cannot', () => {
    const calls: (readonly string[])[] = [];
    removeContainer('atlas-os-engine-test-1', {
      run: (args) => {
        calls.push(args);
        return result(0);
      },
    });
    expect(calls).toEqual([['rm', '--force', 'atlas-os-engine-test-1']]);

    expect(() =>
      removeContainer('atlas-os-engine-test-1', {
        run: () => result(1, 'Error response from daemon: removal already in progress'),
      }),
    ).toThrow(/could not be removed: Error response from daemon: removal already in progress/);
    expect(() =>
      removeContainer('atlas-os-engine-test-1', {
        run: () => ({ ...result(0), error: new Error('spawn docker ENOENT'), status: null }),
      }),
    ).toThrow(/spawn docker ENOENT/);
  });

  it('accepts a missing container only when asked to', () => {
    const missing = () => result(1, 'Error response from daemon: No such container: x');
    expect(() => removeContainer('x', { missingOk: true, run: missing })).not.toThrow();
    expect(() => removeContainer('x', { run: missing })).toThrow(/No such container/);
  });

  it('runs every step and reports every failure without masking an earlier one', async () => {
    const ran: string[] = [];
    const first = new Error('host did not stop');
    const second = new Error('container could not be removed');
    const attempt = cleanUp([
      () => {
        ran.push('host');
        throw first;
      },
      () => {
        ran.push('container');
        throw second;
      },
      async () => {
        ran.push('files');
      },
    ]);
    await expect(attempt).rejects.toBeInstanceOf(AggregateError);
    await attempt.catch((error: AggregateError) => {
      expect(error.errors).toEqual([first, second]);
    });
    expect(ran).toEqual(['host', 'container', 'files']);

    await expect(cleanUp([() => undefined, () => Promise.reject(second)])).rejects.toBe(second);
    await expect(cleanUp([() => undefined])).resolves.toBeUndefined();
  });
});
