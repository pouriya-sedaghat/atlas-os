import { PlatformError } from '@atlas-os/platform';

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'CONFIGURATION_INVALID'
  | 'CONFLICT'
  | 'FEATURE_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly statusCode: number;

  constructor(
    code: AppErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly statusCode: number;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details ?? {};
    this.statusCode = options.statusCode;
  }
}

export function mapPlatformError(error: unknown): AppError {
  if (!(error instanceof PlatformError)) {
    return new AppError('INTERNAL_ERROR', 'An unexpected internal error occurred.', {
      cause: error,
      statusCode: 500,
    });
  }

  switch (error.code) {
    case 'INVALID_REQUEST':
    case 'VALIDATION_FAILED':
      return new AppError('BAD_REQUEST', error.message, {
        cause: error,
        details: error.details,
        statusCode: 400,
      });
    case 'CAPABILITY_UNAVAILABLE':
    case 'DATASET_UNAVAILABLE':
      return new AppError('FEATURE_UNAVAILABLE', error.message, {
        cause: error,
        details: error.details,
        statusCode: 503,
      });
    case 'NOT_FOUND':
      return new AppError('NOT_FOUND', error.message, {
        cause: error,
        details: error.details,
        statusCode: 404,
      });
    case 'CONFLICT':
      return new AppError('CONFLICT', error.message, {
        cause: error,
        details: error.details,
        statusCode: 409,
      });
    case 'NOT_IMPLEMENTED':
      return new AppError('NOT_IMPLEMENTED', error.message, {
        cause: error,
        details: error.details,
        statusCode: 501,
      });
    case 'INTERNAL_ERROR':
      return new AppError('INTERNAL_ERROR', 'An internal platform error occurred.', {
        cause: error,
        statusCode: 500,
      });
  }
}
