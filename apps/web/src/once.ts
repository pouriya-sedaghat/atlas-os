/**
 * Wraps a one-shot asynchronous initialisation so every caller awaits the same attempt.
 *
 * A boolean "already started" flag is not enough for this: it lets a second caller return
 * immediately while the first attempt is still in flight, so work that depends on the
 * initialisation can begin too early. Returning the shared promise makes the ordering
 * deterministic no matter how many callers there are, or how a component remounts.
 *
 * A rejected attempt is not memoised, so a later caller may retry; every caller awaiting the
 * failed attempt still sees that failure rather than a silent success.
 */
export interface OnceRunner<T> {
  (): Promise<T>;
  /** Whether an attempt is in flight or has succeeded. False after a failure. */
  readonly started: boolean;
  /** Forgets any completed or failed attempt. */
  reset(): void;
}

export function once<T>(operation: () => Promise<T>): OnceRunner<T> {
  let attempt: Promise<T> | undefined;

  const runner = (): Promise<T> => {
    attempt ??= operation().catch((error: unknown) => {
      attempt = undefined;
      throw error;
    });
    return attempt;
  };

  Object.defineProperty(runner, 'started', { get: () => attempt !== undefined });
  return Object.assign(runner, {
    reset: () => {
      attempt = undefined;
    },
  }) as OnceRunner<T>;
}
