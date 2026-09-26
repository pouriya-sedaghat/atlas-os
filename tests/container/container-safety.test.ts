import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SEARCH_SERVICES,
  checkComposeNetworkPolicy,
  checkContainerSafety,
  checkSearchImage,
  checkSearchServices,
  checkDatasetMountsAreReadOnly,
  checkGatewayResourceRouting,
  checkNginxRuntimeConfig,
  isForbiddenBuildContextPath,
  requiredGatewayResourceDirectives,
  requiredNginxRuntimeDirectives,
} from '../../scripts/container-safety.mjs';
import {
  LOCAL_PACKAGE_POLICY,
  PRODUCTION_TYPE_EXCEPTION,
  applicationAudit,
  checkLocalPackagePayload,
  checkProductionTypeException,
  discoverLocalPackages,
  forbiddenStoreEntries,
  nearestPackageRoot,
} from '../../scripts/inspect-runtime-images.mjs';

function changeServiceBlock(compose: string, service: string, change: (block: string) => string) {
  const marker = `  ${service}:\n`;
  const start = compose.indexOf(marker);
  const remainderStart = start + marker.length;
  const relativeEnd = compose.slice(remainderStart).search(/\n {2}[a-z][\w-]*:\n/);
  const blockEnd = relativeEnd === -1 ? compose.length : remainderStart + relativeEnd;
  return `${compose.slice(0, start)}${change(compose.slice(start, blockEnd))}${compose.slice(blockEnd)}`;
}

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

  it('enforces the private runtime and loopback edge network topology', async () => {
    const compose = (await readFile(resolve('infra/compose/compose.yaml'), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(() => checkComposeNetworkPolicy(compose)).not.toThrow();

    const gatewayWithoutEdge = compose.replace(
      '    networks:\n      - edge\n      - runtime',
      '    networks:\n      - runtime',
    );
    expect(() => checkComposeNetworkPolicy(gatewayWithoutEdge)).toThrow(
      'Compose gateway service must attach only to edge and runtime.',
    );

    for (const service of ['api', 'web', 'updater']) {
      const backendOnEdge = changeServiceBlock(compose, service, (block) =>
        block.replace('    networks: [runtime]', '    networks: [runtime, edge]'),
      );
      expect(() => checkComposeNetworkPolicy(backendOnEdge)).toThrow(
        `Compose ${service} service must attach only to runtime.`,
      );
    }

    const publicGateway = compose.replace(
      "      - '127.0.0.1:${ATLAS_GATEWAY_PORT:-8080}:8080'",
      "      - '${ATLAS_GATEWAY_PORT:-8080}:8080'",
    );
    expect(() => checkComposeNetworkPolicy(publicGateway)).toThrow(
      'Compose gateway port must publish only on 127.0.0.1.',
    );

    const publicRuntime = compose.replace('    internal: true\n', '');
    expect(() => checkComposeNetworkPolicy(publicRuntime)).toThrow(
      'Compose runtime network must remain internal.',
    );

    const internalEdge = compose.replace(
      '  edge:\n    driver: bridge',
      '  edge:\n    internal: true\n    driver: bridge',
    );
    expect(() => checkComposeNetworkPolicy(internalEdge)).toThrow(
      'Compose edge network must not be internal.',
    );

    const apiWithPort = changeServiceBlock(compose, 'api', (block) =>
      block.replace(
        '    networks: [runtime]',
        "    networks: [runtime]\n    ports:\n      - '127.0.0.1:3000:3000'",
      ),
    );
    expect(() => checkComposeNetworkPolicy(apiWithPort)).toThrow(
      'Compose api service must not publish ports.',
    );
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

describe('basemap resource routing and dataset mounts', () => {
  it('requires the gateway to forward ranges and stream resource responses', async () => {
    const configuration = await readFile(resolve('infra/gateway/nginx.conf'), 'utf8');
    expect(() => checkGatewayResourceRouting(configuration)).not.toThrow();

    for (const directive of requiredGatewayResourceDirectives) {
      expect(() => checkGatewayResourceRouting(configuration.replace(directive, ''))).toThrow(
        `Gateway is missing required resource directive: ${directive}`,
      );
    }
  });

  it('requires every dataset mount to be read-only', async () => {
    const compose = (await readFile(resolve('infra/compose/compose.yaml'), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(checkDatasetMountsAreReadOnly(compose)).toBeGreaterThan(0);

    const writable = compose.replace(':/var/lib/atlas:ro', ':/var/lib/atlas');
    expect(() => checkDatasetMountsAreReadOnly(writable)).toThrow(/must be read-only/);
  });

  it('refuses a Compose file that skips a hardening control on one service', async () => {
    const compose = await readFile(resolve('infra/compose/compose.yaml'), 'utf8');
    const weakened = compose.replace('    read_only: true\n', '');
    const directory = await mkdtemp(join(tmpdir(), 'atlas-compose-'));
    try {
      await mkdir(join(directory, 'infra', 'compose'), { recursive: true });
      await mkdir(join(directory, 'infra', 'images'), { recursive: true });
      await mkdir(join(directory, 'infra', 'gateway'), { recursive: true });
      await writeFile(join(directory, 'infra', 'compose', 'compose.yaml'), weakened);
      for (const path of [
        '.dockerignore',
        'infra/images/server.Dockerfile',
        'infra/images/search.Dockerfile',
        'infra/images/web-nginx.conf',
        'infra/gateway/nginx.conf',
      ]) {
        await copyFile(resolve(path), join(directory, path));
      }
      for (const manifest of [
        'apps/api/package.json',
        'apps/search-host/package.json',
        'apps/updater/package.json',
        'packages/core/package.json',
        'packages/atlas-os/package.json',
      ]) {
        await mkdir(join(directory, dirname(manifest)), { recursive: true });
        await copyFile(resolve(manifest), join(directory, manifest));
      }
      await expect(checkContainerSafety(directory)).rejects.toThrow(/read_only: true/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('search hosts and images', () => {
  async function compose(): Promise<string> {
    return (await readFile(resolve('infra/compose/compose.yaml'), 'utf8')).replaceAll('\r\n', '\n');
  }

  it('accepts one isolated, read-only host per slot', async () => {
    const source = await compose();
    expect(() => checkSearchServices(source)).not.toThrow();
    expect(() => checkComposeNetworkPolicy(source)).not.toThrow();
    expect(SEARCH_SERVICES).toEqual(['search-blue', 'search-green']);
  });

  it.each([
    [
      'publishes a port',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace(
            '    networks: [runtime]',
            "    ports: ['127.0.0.1:2322:2322']\n    networks: [runtime]",
          ),
        ),
      checkComposeNetworkPolicy,
      /must not publish ports/,
    ],
    [
      'joins the edge network',
      (source: string) =>
        changeServiceBlock(source, 'search-green', (block) =>
          block.replace('    networks: [runtime]', '    networks: [runtime, edge]'),
        ),
      checkComposeNetworkPolicy,
      /attach only to runtime/,
    ],
    [
      'serves the other slot',
      (source: string) =>
        changeServiceBlock(source, 'search-green', (block) =>
          block.replace('ATLAS_SEARCH_SLOT: green', 'ATLAS_SEARCH_SLOT: blue'),
        ),
      checkSearchServices,
      /only the green slot/,
    ],
    [
      'shares a work volume',
      (source: string) =>
        changeServiceBlock(source, 'search-green', (block) =>
          block.replace(
            'search-green-work:/var/lib/atlas-engine',
            'search-blue-work:/var/lib/atlas-engine',
          ),
        ),
      checkSearchServices,
      /its own work volume/,
    ],
    [
      'keeps its working copy on a host path',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace('search-blue-work:/var/lib/atlas-engine', './work:/var/lib/atlas-engine'),
        ),
      checkSearchServices,
      /its own work volume/,
    ],
    [
      'mounts the slots writable',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace(':/var/lib/atlas:ro', ':/var/lib/atlas'),
        ),
      checkSearchServices,
      /read-only dataset/,
    ],
    [
      'reaches a host by address rather than service name',
      (source: string) => source.replace('http://search-blue:2322', 'http://172.18.0.5:2322'),
      checkSearchServices,
      /reach the blue search host/,
    ],
    [
      'has no memory limit',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace(/ {4}mem_limit: .*\n/, ''),
        ),
      checkSearchServices,
      /bounded memory limit/,
    ],
    [
      'has a memory limit the operator cannot set',
      (source: string) =>
        changeServiceBlock(source, 'search-green', (block) =>
          block
            .replace(/mem_limit: .*/, 'mem_limit: 2g')
            .replace(/memswap_limit: .*/, 'memswap_limit: 2g'),
        ),
      checkSearchServices,
      /bounded memory limit/,
    ],
    [
      'swaps beyond its memory limit',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace(/memswap_limit: .*/, 'memswap_limit: -1'),
        ),
      checkSearchServices,
      /must not swap/,
    ],
    [
      'has no PID limit',
      (source: string) =>
        changeServiceBlock(source, 'search-green', (block) =>
          block.replace(/ {4}pids_limit: .*\n/, ''),
        ),
      checkSearchServices,
      /bounded PID limit/,
    ],
    [
      'has an unlimited PID default',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace(/pids_limit: .*/, 'pids_limit: ${ATLAS_SEARCH_HOST_PIDS_LIMIT:--1}'),
        ),
      checkSearchServices,
      /bounded PID limit/,
    ],
    [
      'runs the provisioning image',
      (source: string) =>
        changeServiceBlock(source, 'search-blue', (block) =>
          block.replace('image: atlas-os/search:m2', 'image: atlas-os/search-build:m2'),
        ),
      checkSearchServices,
      /provisioning image/,
    ],
  ] as const)('refuses a search host that %s', async (_label, mutate, check, message) => {
    const mutated = mutate(await compose());
    expect(() => check(mutated)).toThrow(message);
  });

  it('keeps build and database tooling out of the serving image', async () => {
    const dockerfile = await readFile(resolve('infra/images/search.Dockerfile'), 'utf8');
    expect(() => checkSearchImage(dockerfile)).not.toThrow();
    const runtime = dockerfile.indexOf('AS search-runtime');
    const inRuntime = (from: string, to: string) =>
      dockerfile.slice(0, runtime) + dockerfile.slice(runtime).replace(from, to);
    for (const [mutated, message] of [
      [inRuntime('USER 10001:10001', 'USER root'), /USER 10001/],
      [inRuntime('WORKDIR /app', 'RUN apt-get install -y postgresql\nWORKDIR /app'), /apt-get/],
      [
        inRuntime('WORKDIR /app', 'COPY --from=build /workspace /workspace\nWORKDIR /app'),
        /workspace/,
      ],
      [
        dockerfile.replace(
          'a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5',
          'f'.repeat(64),
        ),
        /pinned digest/,
      ],
    ] as const) {
      expect(() => checkSearchImage(mutated)).toThrow(message);
    }
  });

  it('never makes the provisioning image a service', async () => {
    const withBuilder = `${await compose()}\n  search-build:\n    image: atlas-os/search-build:m2\n`;
    expect(() => checkSearchServices(withBuilder)).toThrow(/never be a Compose service/);
  });
});

describe('deployed workspace package payload', () => {
  /** The exact shape `pnpm deploy --prod --legacy` produces for a local workspace package. */
  function payload(localName: 'core' | 'platform') {
    const { dependency, version } = LOCAL_PACKAGE_POLICY[localName];
    return {
      binEntries: [dependency],
      dependencyManifest: { name: dependency, version },
      entries: ['dist', 'node_modules', 'package.json'],
      manifest: { dependencies: { [dependency]: version } },
      nodeModulesEntries: ['.bin'],
      shimKind: 'file',
    };
  }

  it('accepts core carrying only its yaml shim', () => {
    expect(LOCAL_PACKAGE_POLICY.core).toEqual({ dependency: 'yaml', version: '2.9.1' });
    expect(() => checkLocalPackagePayload('core', payload('core'))).not.toThrow();
  });

  it('accepts platform carrying only its pbf shim', () => {
    expect(LOCAL_PACKAGE_POLICY.platform).toEqual({ dependency: 'pbf', version: '5.1.2' });
    expect(() => checkLocalPackagePayload('platform', payload('platform'))).not.toThrow();
  });

  it('accepts a shim published as a symbolic link', () => {
    expect(() =>
      checkLocalPackagePayload('core', { ...payload('core'), shimKind: 'symlink' }),
    ).not.toThrow();
  });

  it('rejects the pre-repair layout once a shim is expected', () => {
    // The old policy allowed exactly dist + package.json, which no longer describes the payload.
    expect(() =>
      checkLocalPackagePayload('core', {
        ...payload('core'),
        binEntries: null,
        entries: ['dist', 'package.json'],
        nodeModulesEntries: null,
      }),
    ).toThrow('unexpected files in @atlas-os/core: dist,package.json');
  });

  it('rejects a missing shim inside an otherwise expected layout', () => {
    expect(() =>
      checkLocalPackagePayload('core', {
        ...payload('core'),
        binEntries: [],
        shimKind: 'missing',
      }),
    ).toThrow('unexpected executables in @atlas-os/core: ');
  });

  it('rejects an unexpected top-level entry', () => {
    expect(() =>
      checkLocalPackagePayload('platform', {
        ...payload('platform'),
        entries: ['dist', 'node_modules', 'package.json', 'src'],
      }),
    ).toThrow('unexpected files in @atlas-os/platform: dist,node_modules,package.json,src');
  });

  it('rejects a package-local dependency directory beside the shim', () => {
    expect(() =>
      checkLocalPackagePayload('core', {
        ...payload('core'),
        nodeModulesEntries: ['.bin', 'yaml'],
      }),
    ).toThrow('unexpected node_modules payload in @atlas-os/core: .bin,yaml');
  });

  it('rejects an additional executable shim', () => {
    expect(() =>
      checkLocalPackagePayload('core', { ...payload('core'), binEntries: ['tsx', 'yaml'] }),
    ).toThrow('unexpected executables in @atlas-os/core: tsx,yaml');
  });

  it('rejects the wrong shim name', () => {
    expect(() =>
      checkLocalPackagePayload('core', { ...payload('core'), binEntries: ['pbf'] }),
    ).toThrow('unexpected executables in @atlas-os/core: pbf');
  });

  it('rejects a directory standing in for the shim', () => {
    expect(() =>
      checkLocalPackagePayload('platform', { ...payload('platform'), shimKind: 'directory' }),
    ).toThrow('@atlas-os/platform shim pbf must be a file or symbolic link, found directory');
  });

  it('rejects a shim whose dependency the package does not declare', () => {
    expect(() =>
      checkLocalPackagePayload('core', { ...payload('core'), manifest: { dependencies: {} } }),
    ).toThrow('@atlas-os/core must declare yaml@2.9.1 directly, found undefined');
  });

  it('rejects a declared range instead of the pinned version', () => {
    expect(() =>
      checkLocalPackagePayload('core', {
        ...payload('core'),
        manifest: { dependencies: { yaml: '^2.9.1' } },
      }),
    ).toThrow('@atlas-os/core must declare yaml@2.9.1 directly, found ^2.9.1');
  });

  it('rejects a shim with no deployed package behind it', () => {
    expect(() =>
      checkLocalPackagePayload('platform', { ...payload('platform'), dependencyManifest: null }),
    ).toThrow('@atlas-os/platform shim pbf has no deployed package');
  });

  it('rejects a deployed package whose name does not match the shim', () => {
    expect(() =>
      checkLocalPackagePayload('core', {
        ...payload('core'),
        dependencyManifest: { name: 'yaml-but-not', version: '2.9.1' },
      }),
    ).toThrow('@atlas-os/core expects yaml@2.9.1, deployed yaml-but-not@2.9.1');
  });

  it('rejects a deployed version that drifts from the pinned one', () => {
    expect(() =>
      checkLocalPackagePayload('platform', {
        ...payload('platform'),
        dependencyManifest: { name: 'pbf', version: '5.1.3' },
      }),
    ).toThrow('@atlas-os/platform expects pbf@5.1.2, deployed pbf@5.1.3');
  });

  it('rejects a local workspace package the policy does not name', () => {
    expect(() => checkLocalPackagePayload('api', payload('core'))).toThrow(
      'unexpected local workspace package: @atlas-os/api',
    );
  });

  it('never accepts arbitrary node_modules content for any policy entry', () => {
    for (const localName of Object.keys(LOCAL_PACKAGE_POLICY) as ('core' | 'platform')[]) {
      for (const intruder of ['node_modules', 'zod', '.pnpm', '.package-lock.json']) {
        expect(() =>
          checkLocalPackagePayload(localName, {
            ...payload(localName),
            nodeModulesEntries: ['.bin', intruder],
          }),
        ).toThrow(/unexpected node_modules payload/);
      }
    }
  });

  it('runs the audited image against this exact policy implementation', () => {
    const audit = applicationAudit();
    // The image must decide every policy with the functions these tests exercise, not copies.
    for (const shared of [
      checkLocalPackagePayload.toString(),
      checkProductionTypeException.toString(),
      discoverLocalPackages.toString(),
      forbiddenStoreEntries.toString(),
      nearestPackageRoot.toString(),
      JSON.stringify(LOCAL_PACKAGE_POLICY),
      JSON.stringify(PRODUCTION_TYPE_EXCEPTION),
    ]) {
      expect(audit).toContain(shared);
    }
    // The pre-existing controls stay in the audited script.
    for (const control of [
      'runtime process is not using a non-root UID',
      'unexpected /app entry: ',
      '/workspace leaked into runtime image',
      'root devDependencies leaked into runtime image',
      'development dependencies leaked: ',
      'forbidden app payload: ',
    ]) {
      expect(audit).toContain(control);
    }
    // A deployed manifest's devDependencies key is metadata, so it is no longer a failure by itself.
    expect(audit).not.toContain("' devDependencies leaked'");
  });
});

describe('local workspace package discovery', () => {
  const CORE_ROOT = '/app/node_modules/.store/a/node_modules/@atlas-os/core';
  const PLATFORM_ROOT = '/app/node_modules/.store/b/node_modules/@atlas-os/platform';
  const CORE_ENTRY = `${CORE_ROOT}/dist/index.js`;
  const PLATFORM_ENTRY = `${PLATFORM_ROOT}/dist/index.js`;

  function ports(overrides: Record<string, unknown> = {}) {
    const manifests: Record<string, unknown> = {
      [CORE_ROOT]: { name: '@atlas-os/core' },
      [PLATFORM_ROOT]: { name: '@atlas-os/platform' },
    };
    return {
      applicationEntry: () => CORE_ENTRY,
      readManifest: (directory: string) => manifests[directory] ?? null,
      resolveFrom: () => PLATFORM_ENTRY,
      ...overrides,
    };
  }

  it('discovers both packages exactly once', () => {
    const discovered = discoverLocalPackages(ports());
    expect([...discovered.keys()]).toEqual(['core', 'platform']);
    expect(discovered.get('core').root).toBe(CORE_ROOT);
    expect(discovered.get('platform').root).toBe(PLATFORM_ROOT);
  });

  it('reaches platform through core rather than the application root', () => {
    const applicationRequests: string[] = [];
    const resolutions: string[][] = [];
    discoverLocalPackages(
      ports({
        applicationEntry: (request: string) => {
          applicationRequests.push(request);
          return CORE_ENTRY;
        },
        resolveFrom: (from: string, request: string) => {
          resolutions.push([from, request]);
          return PLATFORM_ENTRY;
        },
      }),
    );
    // The application root is asked for core only; platform comes out of core's own graph.
    expect(applicationRequests).toEqual(['@atlas-os/core']);
    expect(resolutions).toEqual([[CORE_ROOT, '@atlas-os/platform']]);
  });

  it('requires core', () => {
    expect(() =>
      discoverLocalPackages(
        ports({
          applicationEntry: () => {
            throw new Error('Cannot find module');
          },
        }),
      ),
    ).toThrow('@atlas-os/core is not resolvable from the application root');
  });

  it('requires platform to be resolvable', () => {
    expect(() =>
      discoverLocalPackages(
        ports({
          resolveFrom: () => {
            throw new Error('Cannot find module');
          },
        }),
      ),
    ).toThrow('@atlas-os/platform is not resolvable from @atlas-os/core');
  });

  it('rejects a platform entry with no package manifest above it', () => {
    expect(() =>
      discoverLocalPackages(ports({ resolveFrom: () => '/elsewhere/dist/index.js' })),
    ).toThrow('no package manifest above /elsewhere/dist/index.js');
  });

  it('rejects a resolved entry whose nearest manifest carries the wrong name', () => {
    const impostorRoot = '/app/node_modules/.store/c/node_modules/@atlas-os/other';
    expect(() =>
      discoverLocalPackages(
        ports({
          readManifest: (directory: string) =>
            directory === CORE_ROOT
              ? { name: '@atlas-os/core' }
              : directory === impostorRoot
                ? { name: '@atlas-os/other' }
                : null,
          resolveFrom: () => `${impostorRoot}/dist/index.js`,
        }),
      ),
    ).toThrow('@atlas-os/platform resolved into @atlas-os/other');
  });

  it('rejects platform resolving back onto core', () => {
    expect(() => discoverLocalPackages(ports({ resolveFrom: () => CORE_ENTRY }))).toThrow(
      '@atlas-os/platform resolved into @atlas-os/core',
    );
  });

  it('credits a resolved entry to the first manifest above it, not an enclosing one', () => {
    const readManifest = (directory: string) =>
      directory === '/x/node_modules/inner'
        ? { name: 'inner' }
        : directory === '/x'
          ? { name: 'outer' }
          : null;
    expect(nearestPackageRoot('/x/node_modules/inner/lib/a.js', readManifest)).toEqual({
      manifest: { name: 'inner' },
      root: '/x/node_modules/inner',
    });
    expect(nearestPackageRoot('/nowhere/a.js', () => null)).toBeNull();
  });
});

describe('production store contents', () => {
  const proven = {
    dependencyManifest: { name: '@types/geojson', version: '7946.0.16' },
    parentManifest: {
      dependencies: { '@types/geojson': '^7946.0.16' },
      name: '@maplibre/vt-pbf',
      version: '4.3.2',
    },
  };

  it('accepts only the fully proven production type edge', () => {
    expect(checkProductionTypeException(proven)).toBe('@types+geojson@7946.0.16');
    expect(PRODUCTION_TYPE_EXCEPTION.storeEntry).toBe('@types+geojson@7946.0.16');
  });

  it('rejects an unresolvable parent', () => {
    expect(() => checkProductionTypeException({ ...proven, parentManifest: null })).toThrow(
      '@maplibre/vt-pbf is not resolvable from @atlas-os/platform',
    );
  });

  it('rejects the wrong parent package name', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        parentManifest: { ...proven.parentManifest, name: '@maplibre/vt-pbf-fork' },
      }),
    ).toThrow(
      'type exception expects @maplibre/vt-pbf@4.3.2, resolved @maplibre/vt-pbf-fork@4.3.2',
    );
  });

  it('rejects the wrong parent version', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        parentManifest: { ...proven.parentManifest, version: '4.3.3' },
      }),
    ).toThrow('type exception expects @maplibre/vt-pbf@4.3.2, resolved @maplibre/vt-pbf@4.3.3');
  });

  it('rejects a parent that does not declare the dependency', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        parentManifest: { ...proven.parentManifest, dependencies: {} },
      }),
    ).toThrow('@maplibre/vt-pbf must declare @types/geojson: ^7946.0.16, found undefined');
  });

  it('rejects a parent declaring a different range', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        parentManifest: {
          ...proven.parentManifest,
          dependencies: { '@types/geojson': '^7946.0.17' },
        },
      }),
    ).toThrow('@maplibre/vt-pbf must declare @types/geojson: ^7946.0.16, found ^7946.0.17');
  });

  it('rejects an unresolvable dependency', () => {
    expect(() => checkProductionTypeException({ ...proven, dependencyManifest: null })).toThrow(
      '@types/geojson is not resolvable from @maplibre/vt-pbf',
    );
  });

  it('rejects a deployed dependency name mismatch', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        dependencyManifest: { name: '@types/geojson-ish', version: '7946.0.16' },
      }),
    ).toThrow(
      'type exception expects @types/geojson@7946.0.16, deployed @types/geojson-ish@7946.0.16',
    );
  });

  it('rejects a deployed dependency version mismatch', () => {
    expect(() =>
      checkProductionTypeException({
        ...proven,
        dependencyManifest: { name: '@types/geojson', version: '7946.0.17' },
      }),
    ).toThrow('type exception expects @types/geojson@7946.0.16, deployed @types/geojson@7946.0.17');
  });

  it('admits the proven store entry and nothing else', () => {
    const allowed = [checkProductionTypeException(proven)];
    expect(forbiddenStoreEntries(['@types+geojson@7946.0.16', 'pbf@5.1.2'], allowed)).toEqual([]);
  });

  it('still rejects a differently versioned copy of the same type package', () => {
    const allowed = [checkProductionTypeException(proven)];
    expect(forbiddenStoreEntries(['@types+geojson@7946.0.15'], allowed)).toEqual([
      '@types+geojson@7946.0.15',
    ]);
  });

  it('still rejects another type package alongside the proven one', () => {
    const allowed = [checkProductionTypeException(proven)];
    expect(
      forbiddenStoreEntries(
        ['@types+geojson@7946.0.16', '@types+fontkit@2.0.9', '@types+node@22.20.4'],
        allowed,
      ),
    ).toEqual(['@types+fontkit@2.0.9', '@types+node@22.20.4']);
  });

  it('rejects @types/fontkit even though platform declares it as metadata', () => {
    expect(forbiddenStoreEntries(['@types+fontkit@2.0.9'], [])).toEqual(['@types+fontkit@2.0.9']);
  });

  it('keeps every other development tooling pattern forbidden', () => {
    const entries = [
      '@eslint+js@9.35.0',
      '@vitejs+plugin-react@5.0.2',
      'esbuild@0.25.0',
      'eslint@9.35.0',
      'prettier@3.6.2',
      'rollup@4.50.1',
      'tsx@4.20.5',
      'typescript@5.9.2',
      'typescript-eslint@8.43.0',
      'vite@7.1.5',
      'vitest@3.2.4',
    ];
    expect(forbiddenStoreEntries(entries, ['@types+geojson@7946.0.16'])).toEqual(entries);
    expect(forbiddenStoreEntries(['fastify@5.6.0', 'yaml@2.9.1', 'pbf@5.1.2'], [])).toEqual([]);
  });

  it('treats a deployed devDependencies key as metadata rather than an installed payload', () => {
    // The deployed @atlas-os/platform manifest keeps its @types/* devDependencies; what matters is
    // that nothing forbidden is actually installed in the store.
    const platformManifest = {
      dependencies: { pbf: '5.1.2' },
      devDependencies: { '@types/fontkit': '2.0.9', '@types/geojson': '7946.0.16' },
      name: '@atlas-os/platform',
    };
    expect(() =>
      checkLocalPackagePayload('platform', {
        binEntries: ['pbf'],
        dependencyManifest: { name: 'pbf', version: '5.1.2' },
        entries: ['dist', 'node_modules', 'package.json'],
        manifest: platformManifest,
        nodeModulesEntries: ['.bin'],
        shimKind: 'file',
      }),
    ).not.toThrow();
    expect(forbiddenStoreEntries(['pbf@5.1.2'], [])).toEqual([]);
    expect(forbiddenStoreEntries(['@types+fontkit@2.0.9'], [])).toEqual(['@types+fontkit@2.0.9']);
  });
});
