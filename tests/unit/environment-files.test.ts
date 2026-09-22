import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('environment address safety', () => {
  it('uses loopback addresses in the client-facing environment example', () => {
    const example = repositoryFile('.env.example');
    expect(example).toContain('ATLAS_API_HOST=127.0.0.1');
    expect(example).toContain('ATLAS_UPDATER_HOST=127.0.0.1');
    expect(example).toContain('ATLAS_GATEWAY_ORIGIN=http://localhost:8080');
    expect(example).not.toContain('0.0.0.0');
  });

  it('documents the provisioning variables without embedding a secret', () => {
    const example = repositoryFile('.env.example');
    expect(example).toContain('ATLAS_FONT_PATH=');
    // Tooling configuration is documented as platform-internal and commented out by default.
    expect(example).toContain('ATLAS_TILE_TOOL_KIND');
    expect(example).not.toMatch(/^ATLAS_TILE_TOOL_KIND=/m);
    expect(example).not.toMatch(/(?:password|secret|token|api[_-]?key)\s*=\s*\S+/i);
  });

  it('mounts the dataset read-only into every serving container', () => {
    const compose = repositoryFile('infra/compose/compose.yaml');
    const mounts = compose.match(/\$\{ATLAS_DATA_ROOT:[^}]*\}:[^\n]*/g) ?? [];
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) expect(mount).toMatch(/:ro$/);
  });

  it('uses wildcard addresses only for container binds and keeps a browser-facing origin', () => {
    const compose = repositoryFile('infra/compose/compose.yaml');
    expect(compose).toContain('ATLAS_API_HOST: 0.0.0.0');
    expect(compose).toContain('ATLAS_UPDATER_HOST: 0.0.0.0');
    expect(compose).toContain('ATLAS_GATEWAY_ORIGIN: http://127.0.0.1:8080');
    expect(compose).not.toContain('ATLAS_GATEWAY_ORIGIN: http://gateway:8080');
  });
});
