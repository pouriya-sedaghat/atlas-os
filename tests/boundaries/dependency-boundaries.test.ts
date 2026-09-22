import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { analyzeImport, validateWorkspaceGraph } from '../../scripts/boundaries.mjs';

describe('dependency boundary enforcement', () => {
  it('rejects an application importing the platform root directly', () => {
    const fixture = readFileSync(
      new URL('../fixtures/boundaries/invalid-app.fixture', import.meta.url),
      'utf8',
    );
    const specifier = /from\s+['"]([^'"]+)/.exec(fixture)?.[1];
    if (specifier === undefined) throw new Error('Fixture import was not found.');
    expect(
      analyzeImport({ importerLayer: 'app', importerPath: 'invalid-app.fixture', specifier }),
    ).toEqual([expect.stringContaining('must import @atlas-os/core')]);
  });

  it.each([
    {
      importerLayer: 'app',
      importerPath: 'apps/api/src/invalid.ts',
      message: 'must import @atlas-os/core',
      specifier: '@atlas-os/platform/contracts',
    },
    {
      importerLayer: 'platform',
      importerPath: 'packages/atlas-os/src/invalid.ts',
      message: 'must not import @atlas-os/core',
      specifier: '@atlas-os/core/config',
    },
    {
      importerLayer: 'app',
      importerPath: 'apps/api/src/invalid.ts',
      message: 'cross-workspace relative import',
      specifier: '../../../packages/atlas-os/src/index.js',
    },
    {
      importerLayer: 'core',
      importerPath: 'packages/core/src/invalid.ts',
      message: 'core must not import an application',
      specifier: '../../../apps/api/src/server.js',
    },
    {
      importerLayer: 'platform',
      importerPath: 'packages/atlas-os/src/invalid.ts',
      message: 'platform must not import an application',
      specifier: '../../../apps/updater/src/server.js',
    },
  ])('rejects bypass $specifier', ({ importerLayer, importerPath, message, specifier }) => {
    expect(
      analyzeImport({
        importerLayer,
        importerPath,
        root: '/',
        specifier,
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
  });

  it('rejects a relative import between different applications', () => {
    const violations = analyzeImport({
      importerLayer: 'app',
      importerPath: 'apps/api/src/invalid.ts',
      root: '/',
      specifier: '../../../apps/updater/src/server.js',
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cross-workspace relative import'),
        expect.stringContaining('applications must not depend on another application'),
      ]),
    );
  });

  it('allows relative imports within the same application', () => {
    expect(
      analyzeImport({
        importerLayer: 'app',
        importerPath: 'apps/api/src/index.ts',
        root: '/',
        specifier: './server.js',
      }),
    ).toEqual([]);
  });

  it('rejects application package imports from core and platform', () => {
    const workspaces = new Map([['@atlas-os/api', { layer: 'app', unit: 'apps/api' }]]);
    expect(
      analyzeImport({
        importerLayer: 'core',
        importerPath: 'packages/core/src/invalid.ts',
        specifier: '@atlas-os/api/server',
        workspaces,
      }),
    ).toEqual([expect.stringContaining('core must not import an application')]);
    expect(
      analyzeImport({
        importerLayer: 'platform',
        importerPath: 'packages/atlas-os/src/invalid.ts',
        specifier: '@atlas-os/api',
        workspaces,
      }),
    ).toEqual([expect.stringContaining('platform must not import an application')]);
  });

  it('rejects reverse and cyclic local workspace dependencies', () => {
    const graph = [
      {
        layer: 'platform',
        manifest: { dependencies: { '@atlas-os/core': 'workspace:*' } },
        name: '@atlas-os/platform',
      },
      {
        layer: 'core',
        manifest: { dependencies: { '@atlas-os/platform': 'workspace:*' } },
        name: '@atlas-os/core',
      },
    ];
    expect(validateWorkspaceGraph(graph)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('forbidden local dependency'),
        expect.stringContaining('cyclic workspace dependency'),
      ]),
    );
  });
});
