import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

/** Every operator- and developer-facing guide. */
const GUIDES = [
  'README.md',
  'DATA_SOURCES.md',
  'THIRD_PARTY_NOTICES.md',
  ...readdirSync(new URL('../../docs', import.meta.url), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.md'))
    .map((path) => join('docs', path).replaceAll('\\', '/')),
];

/** A POSIX-only `NAME=value command` prefix, which PowerShell and Command Prompt reject. */
const INLINE_ASSIGNMENT = /^\s*[A-Z][A-Z0-9_]*=\S*\s+\S/m;

function sentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.;:])\s/);
}

describe('documentation', () => {
  it('covers the guides this change adds', () => {
    expect(GUIDES).toEqual(expect.arrayContaining(['docs/adr/0001-offline-search.md']));
  });

  it('uses no POSIX-only inline environment assignment in any guide', () => {
    for (const path of GUIDES) {
      expect(repositoryFile(path), path).not.toMatch(INLINE_ASSIGNMENT);
    }
  });

  it('documents only package scripts that exist', () => {
    const scripts = Object.keys(
      (JSON.parse(repositoryFile('package.json')) as { scripts: Record<string, string> }).scripts,
    );
    const builtIn = ['install', 'exec', 'build', 'check', 'test', 'verify', 'format', 'lint'];
    for (const path of GUIDES) {
      // Commands appear in code, never in prose; only code spans and blocks are read.
      const code = [...repositoryFile(path).matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map(
        (match) => match[0],
      );
      for (const block of code) {
        for (const [, script] of block.matchAll(/\bpnpm ([a-z][\w:-]*)/g)) {
          if (builtIn.includes(script!) || script === 'typecheck') continue;
          expect(scripts, `${path} documents pnpm ${script}`).toContain(script);
        }
      }
    }
    expect(scripts).toEqual(expect.arrayContaining(['dataset:fixture', 'test:engine']));
  });

  it('states exactly where the real engine is supported, and claims nothing more', () => {
    const development = repositoryFile('docs/development.md').replace(/\s+/g, ' ');
    expect(development).toContain(
      'Running the real engine or the database build natively on Windows has not been proved and is not supported.',
    );
    for (const path of GUIDES) {
      for (const sentence of sentences(repositoryFile(path))) {
        const claimsNativeWindows =
          /\bnative(?:ly)?\b/i.test(sentence) &&
          /\bWindows\b/.test(sentence) &&
          /\b(?:real engine|engine archive|database build|photon|nominatim)\b/i.test(sentence);
        if (claimsNativeWindows) {
          expect(sentence, `${path} must not claim native Windows engine support`).toMatch(
            /\bnot\b/,
          );
        }
      }
    }
  });

  it('never tells an operator to download a regional extract', () => {
    for (const path of GUIDES) {
      const text = repositoryFile(path);
      expect(text, path).not.toMatch(/\b(?:curl|wget|Invoke-WebRequest)\b[^\n]*\.osm\.pbf/);
    }
  });
});
