import { createApplicationComposition } from '@atlas-os/core';
import { describe, expect, it } from 'vitest';

describe('startup configuration', () => {
  it('fails before server startup when configuration is invalid', () => {
    expect(() => createApplicationComposition({ ATLAS_GATEWAY_ORIGIN: 'not a URL' })).toThrowError(
      /configuration is invalid/i,
    );
  });
});
