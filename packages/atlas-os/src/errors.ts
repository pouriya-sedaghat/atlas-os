export type PlatformErrorCode =
  | 'INVALID_REQUEST'
  | 'CAPABILITY_UNAVAILABLE'
  | 'DATASET_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR';

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(
    code: PlatformErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PlatformError';
    this.code = code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
  }
}
