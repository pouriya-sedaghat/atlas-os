import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkContainerSafety,
  checkNginxRuntimeConfig,
  isForbiddenBuildContextPath,
  requiredNginxRuntimeDirectives,
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

  for (const configPath of ['infra/images/web-nginx.conf', 'infra/gateway/nginx.conf']) {
    it(`${configPath} requires every read-only nginx runtime path`, async () => {
      const configuration = await readFile(resolve(configPath), 'utf8');
      expect(() => checkNginxRuntimeConfig(configuration, configPath)).not.toThrow();

      for (const directive of requiredNginxRuntimeDirectives) {
        const incompleteConfiguration = configuration.replace(directive, '');
        expect(() => checkNginxRuntimeConfig(incompleteConfiguration, configPath)).toThrow(
          `${configPath} is missing required runtime directive: ${directive}`,
        );
      }
    });
  }
});
