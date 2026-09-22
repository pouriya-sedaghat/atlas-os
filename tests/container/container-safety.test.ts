import { describe, expect, it } from 'vitest';

import {
  checkContainerSafety,
  isForbiddenBuildContextPath,
} from '../../scripts/container-safety.mjs';

describe('container context and runtime safety', () => {
  it('excludes local environment and review artifacts while preserving the example', () => {
    expect(isForbiddenBuildContextPath('.env')).toBe(true);
    expect(isForbiddenBuildContextPath('.env.production')).toBe(true);
    expect(isForbiddenBuildContextPath('apps/api/.env.local')).toBe(true);
    expect(isForbiddenBuildContextPath('.validation/web-dist/app.js')).toBe(true);
    expect(isForbiddenBuildContextPath('review.patch')).toBe(true);
    expect(isForbiddenBuildContextPath('atlas-os.diff')).toBe(true);
    expect(isForbiddenBuildContextPath('.env.example')).toBe(false);
  });

  it('enforces minimal production runtime stages and package payloads', async () => {
    await expect(checkContainerSafety()).resolves.toBeUndefined();
  });
});
