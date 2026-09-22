import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('supply-chain pinning', () => {
  it('pins every GitHub Action to a full commit SHA', () => {
    const workflow = repositoryFile('.github/workflows/ci.yml');
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[a-f0-9]{40}$/);
    }
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/);
  });

  it('pins every external base image to an immutable sha256 digest', () => {
    const files = [
      repositoryFile('infra/images/server.Dockerfile'),
      repositoryFile('infra/images/web.Dockerfile'),
      repositoryFile('infra/compose/compose.yaml'),
    ].join('\n');
    for (const image of ['node:22.14.0-alpine3.21', 'nginxinc/nginx-unprivileged:1.27.5-alpine']) {
      const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(files).toMatch(new RegExp(`${escaped}@sha256:[a-f0-9]{64}`));
    }
    expect(files).not.toMatch(
      /(?:FROM|image:)\s+(?:node|nginxinc\/nginx-unprivileged):[^\s@]+(?:\s|$)/,
    );
  });
});
