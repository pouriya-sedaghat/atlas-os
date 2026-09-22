import { AppError, mapPlatformError } from '@atlas-os/core';
import { PlatformError } from '@atlas-os/platform';
import { describe, expect, it } from 'vitest';

describe('typed errors', () => {
  it('maps capability errors without exposing a stack or provider response', () => {
    const mapped = mapPlatformError(
      new PlatformError('CAPABILITY_UNAVAILABLE', 'Routing is unavailable.', {
        details: { capability: 'routing' },
      }),
    );
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({ code: 'FEATURE_UNAVAILABLE', statusCode: 503 });
    expect(mapped.details).toEqual({ capability: 'routing' });
  });

  it('maps unknown failures to a safe internal error', () => {
    expect(mapPlatformError(new Error('secret details'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
      statusCode: 500,
    });
  });
});
