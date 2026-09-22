import { AppError, createApplicationComposition, loadConfig } from '@atlas-os/core';
import { describe, expect, it } from 'vitest';

import { buildApiServer, resolveLoggerConfiguration } from '../../apps/api/src/server.js';

describe('configuration validation', () => {
  it('creates typed defaults for a local offline runtime', () => {
    const config = loadConfig({}, '/workspace');
    expect(config).toMatchObject({
      api: { host: '127.0.0.1', port: 3000 },
      gatewayOrigin: 'http://127.0.0.1:8080',
      logLevel: 'info',
      offline: true,
      profile: 'default',
      region: 'iran',
      updateMode: 'disabled',
    });
    expect(config.dataRoot).toContain('data');
  });

  it('applies the configured log level while preserving disabled test logging', async () => {
    const config = loadConfig({ ATLAS_LOG_LEVEL: 'debug' });
    expect(resolveLoggerConfiguration(config.logLevel)).toEqual({ level: 'debug' });
    expect(resolveLoggerConfiguration(config.logLevel, false)).toBe(false);

    const server = buildApiServer(createApplicationComposition({ ATLAS_LOG_LEVEL: 'debug' }));
    expect(server.log.level).toBe('debug');
    await server.close();
  });

  it('fails fast for invalid ports and booleans', () => {
    expect(() => loadConfig({ ATLAS_API_PORT: '70000' })).toThrow(AppError);
    expect(() => loadConfig({ ATLAS_OFFLINE: 'sometimes' })).toThrow(AppError);
  });
});
