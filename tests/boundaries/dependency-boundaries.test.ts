import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

  it.each([
    ['@atlas-os/platform/internal/tools/planetiler'],
    ['../../../packages/atlas-os/src/internal/builders/external.js'],
    ['./internal/providers/index.js'],
    ['../providers/tiles.js'],
  ])('keeps the private platform module %s out of an application', (specifier) => {
    expect(
      analyzeImport({
        importerLayer: 'app',
        importerPath: 'apps/api/src/invalid.ts',
        root: '/',
        specifier,
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('private to packages/atlas-os')]));
  });

  it('keeps private platform modules out of core', () => {
    expect(
      analyzeImport({
        importerLayer: 'core',
        importerPath: 'packages/core/src/invalid.ts',
        root: '/',
        specifier: '@atlas-os/platform/internal/snapshot/store',
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('private to packages/atlas-os')]));
  });

  it('allows the platform to import its own private modules', () => {
    expect(
      analyzeImport({
        importerLayer: 'platform',
        importerPath: 'packages/atlas-os/src/provisioning.ts',
        root: '/',
        specifier: './internal/snapshot/store.js',
      }),
    ).toEqual([]);
  });

  it('keeps provider and tooling identifiers out of core and the applications', () => {
    // Provider selection and provider-specific execution configuration belong inside the
    // platform package. That includes the search engine, its build tools and its datastore. Core passes neutral provisioning intent and the raw environment; it must
    // not know that a tile tool exists, which one is selected, or how it runs.
    // Tool and vendor identifiers, the tool's own source names, and its execution
    // configuration. Neutral data-role names such as `coastline_polygons` and
    // `lake_centerlines` are public contract terms describing what the data is, so they are
    // deliberately absent from this list.
    const forbidden =
      /planetiler|openmaptiles|maplibre|pmtiles|natural[_-]?earth|water[_-]?polygons|tile[_-]?tool|basemap[_-]?builder|ATLAS_TILE_TOOL|ATLAS_BASEMAP_BUILDER|--\w+_path\b|photon|nominatim|opensearch|komoot|osm2pgsql|postgis|pelias|ATLAS_SEARCH_TOOL/i;

    const roots = [
      resolve('packages/core/src'),
      resolve('apps/api/src'),
      resolve('apps/cli/src'),
      resolve('apps/updater/src'),
      resolve('apps/search-host/src'),
    ];

    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.ts')) continue;
        const path = join(file.parentPath, file.name);
        const source = readFileSync(path, 'utf8');
        for (const [index, line] of source.split('\n').entries()) {
          if (forbidden.test(line)) offenders.push(`${relative(process.cwd(), path)}:${index + 1}`);
        }
      }
    }

    expect(offenders, `provider identifiers leaked into: ${offenders.join(', ')}`).toEqual([]);
  });

  it('exposes operator inputs only as neutral data roles', () => {
    // Every input flag the command-line tool offers must correspond to a role in the public
    // contract, so an operator never names a tool source and an application never selects one.
    const cli = readFileSync(resolve('apps/cli/src/run.ts'), 'utf8');
    const contracts = readFileSync(resolve('packages/atlas-os/src/contracts.ts'), 'utf8');

    const kinds = [...cli.matchAll(/'[a-z-]+': '([a-z_]+)',/g)].map((match) => match[1]!);
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(contracts, `kind ${kind} is not a public DatasetInputKind`).toContain(`'${kind}'`);
    }
    // The command line must never offer a provider selector.
    expect(cli).not.toMatch(/--builder|synthetic/i);
  });

  it('allows the platform package to name its own tooling', () => {
    const tool = readFileSync(
      resolve('packages/atlas-os/src/internal/tools/planetiler.ts'),
      'utf8',
    );
    expect(tool).toContain('planetiler');
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
