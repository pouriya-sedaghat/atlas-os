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

  it('uses wildcard addresses only for container binds and keeps a browser-facing origin', () => {
    const compose = repositoryFile('infra/compose/compose.yaml');
    expect(compose).toContain('ATLAS_API_HOST: 0.0.0.0');
    expect(compose).toContain('ATLAS_UPDATER_HOST: 0.0.0.0');
    expect(compose).toContain('ATLAS_GATEWAY_ORIGIN: http://127.0.0.1:8080');
    expect(compose).not.toContain('ATLAS_GATEWAY_ORIGIN: http://gateway:8080');
  });
});
