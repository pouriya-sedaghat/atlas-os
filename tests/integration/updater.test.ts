import { createApplicationComposition } from '@atlas-os/core';
import { describe, expect, it } from 'vitest';

import { updaterHealth } from '../../apps/updater/src/server.js';

describe('updater process boundary', () => {
  it('treats missing network connectivity as non-fatal', () => {
    expect(updaterHealth(createApplicationComposition({ ATLAS_OFFLINE: 'true' }))).toEqual({
      ready: true,
      service: 'updater',
      status: 'ok',
      updateConnectivity: 'offline',
    });
  });

  it('distinguishes not configured connectivity from runtime readiness', () => {
    expect(updaterHealth(createApplicationComposition({ ATLAS_OFFLINE: 'false' }))).toMatchObject({
      ready: true,
      status: 'ok',
      updateConnectivity: 'not_configured',
    });
  });
});
