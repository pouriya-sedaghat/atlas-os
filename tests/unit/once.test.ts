import { describe, expect, it, vi } from 'vitest';

import { once } from '../../apps/web/src/once.js';

/**
 * This is the ordering guarantee right-to-left text shaping depends on. The renderer's plugin
 * registry is global and rejects a second registration, and a map constructed before shaping is
 * ready renders Persian labels unshaped — so "already started" must mean "await the same
 * attempt", not "return immediately".
 */
describe('one-shot initialisation', () => {
  it('runs the operation once and shares the result', async () => {
    const operation = vi.fn(async () => 'ready');
    const run = once(operation);

    await expect(Promise.all([run(), run(), run()])).resolves.toEqual(['ready', 'ready', 'ready']);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives concurrent callers the identical pending promise', async () => {
    let settle: ((value: string) => void) | undefined;
    const run = once(
      () =>
        new Promise<string>((resolveAttempt) => {
          settle = resolveAttempt;
        }),
    );

    const first = run();
    const second = run();
    expect(second).toBe(first);

    // A boolean flag would let this caller resolve while the first attempt is still in flight.
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled, 'a later caller resolved before the attempt completed').toBe(false);

    settle?.('ready');
    await expect(second).resolves.toBe('ready');
  });

  it('never runs the operation again once it has succeeded', async () => {
    const operation = vi.fn(async () => 'ready');
    const run = once(operation);

    await run();
    await run();
    await run();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(run.started).toBe(true);
  });

  it('propagates a failure to every caller awaiting that attempt', async () => {
    const failure = new Error('load failed');
    const operation = vi.fn(async () => {
      throw failure;
    });
    const run = once(operation);

    const first = run();
    const second = run();
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not memoise a failure, so a later caller may retry', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ready');
    const run = once(operation);

    await expect(run()).rejects.toThrow('transient');
    expect(run.started, 'a failed attempt must not be recorded as started').toBe(false);

    await expect(run()).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(run.started).toBe(true);
  });

  it('reports no attempt before the first call', () => {
    const run = once(async () => 'ready');
    expect(run.started).toBe(false);
  });

  it('forgets a completed attempt when reset', async () => {
    const operation = vi.fn(async () => 'ready');
    const run = once(operation);

    await run();
    run.reset();
    expect(run.started).toBe(false);
    await run();

    expect(operation).toHaveBeenCalledTimes(2);
  });
});
