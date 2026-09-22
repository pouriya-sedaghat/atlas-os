/**
 * Process exit codes. Stable and documented so an operator's automation can branch on them
 * instead of parsing text.
 */
export const EXIT = {
  /** The command completed. */
  ok: 0,
  /** The command ran but the operation failed. */
  failure: 1,
  /** Another dataset operation holds the lock, or there is nothing to roll back. */
  conflict: 2,
  /** A snapshot did not validate. */
  invalidSnapshot: 3,
  /** The referenced snapshot does not exist. */
  notFound: 4,
  /** The command line could not be understood. */
  usage: 64,
  /** Configuration is invalid. */
  configuration: 78,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
