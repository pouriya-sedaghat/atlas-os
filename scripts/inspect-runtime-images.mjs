import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Executable shims a local workspace package is allowed to carry.
 *
 * `pnpm deploy` writes `node_modules/.bin/<name>` inside a workspace package whenever one of its
 * direct production dependencies publishes a `bin` entry. Those shims are legitimate package
 * manager output, so the audit states the exact shape it expects for each package rather than
 * allowing a `node_modules` directory in general: one named shim, for one declared dependency,
 * pinned to one version.
 */
export const LOCAL_PACKAGE_POLICY = {
  core: { dependency: 'yaml', version: '2.9.1' },
  platform: { dependency: 'pbf', version: '5.1.2' },
};

/**
 * The single `@types` package allowed to reach a runtime image.
 *
 * `@maplibre/vt-pbf` declares `@types/geojson` among its runtime `dependencies`, so pnpm installs
 * it into the production store. It is admitted only once the whole edge has been proven: the
 * parent package resolves at its pinned version, that parent declares this exact range, and the
 * dependency resolves to this exact name and version.
 */
export const PRODUCTION_TYPE_EXCEPTION = {
  dependency: { name: '@types/geojson', range: '^7946.0.16', version: '7946.0.16' },
  parent: { name: '@maplibre/vt-pbf', version: '4.3.2' },
  storeEntry: '@types+geojson@7946.0.16',
};

/** Development tooling that must never appear in a production store. */
export const FORBIDDEN_STORE_PATTERN =
  /^(?:@eslint\+|@types\+|@vitejs\+|esbuild@|eslint@|prettier@|rollup@|tsx@|typescript@|typescript-eslint@|vite@|vitest@)/;

/** Parent of a POSIX path, or null once the root is reached. */
export function parentDirectory(pathname) {
  const index = pathname.lastIndexOf('/');
  if (index < 0) return null;
  if (index === 0) return pathname.length > 1 ? '/' : null;
  return pathname.slice(0, index);
}

/**
 * The package a resolved module entry belongs to.
 *
 * Walks upward from the entry to the first directory carrying a manifest, which is that module's
 * own package. Stopping at the first manifest is what keeps a resolved file from being credited
 * to some enclosing directory.
 */
export function nearestPackageRoot(entryPath, readManifest) {
  let current = parentDirectory(entryPath);
  while (current !== null) {
    const manifest = readManifest(current);
    if (manifest !== null && manifest !== undefined) return { manifest, root: current };
    current = parentDirectory(current);
  }
  return null;
}

/**
 * Locates every local workspace package the audit must inspect.
 *
 * `core` is resolved from the application root and `platform` from `core`, following the same
 * production dependency graph Node itself follows. Nothing here reads a store directory name, so
 * the audit does not depend on how pnpm encodes them. Both packages are mandatory: a package that
 * cannot be resolved fails the audit instead of being skipped.
 */
export function discoverLocalPackages(ports, policy = LOCAL_PACKAGE_POLICY) {
  const discovered = new Map();
  const roots = new Set();

  function adopt(localName, entryPath) {
    const expectedName = '@atlas-os/' + localName;
    const found = nearestPackageRoot(entryPath, ports.readManifest);
    if (found === null) {
      throw new Error('no package manifest above ' + entryPath);
    }
    if (found.manifest.name !== expectedName) {
      throw new Error(expectedName + ' resolved into ' + String(found.manifest.name));
    }
    if (discovered.has(localName) || roots.has(found.root)) {
      throw new Error('duplicate local workspace package discovered: ' + expectedName);
    }
    discovered.set(localName, found);
    roots.add(found.root);
  }

  let coreEntry;
  try {
    coreEntry = ports.applicationEntry('@atlas-os/core');
  } catch (cause) {
    throw new Error(
      '@atlas-os/core is not resolvable from the application root: ' +
        String(cause && cause.message),
    );
  }
  adopt('core', coreEntry);

  let platformEntry;
  try {
    platformEntry = ports.resolveFrom(discovered.get('core').root, '@atlas-os/platform');
  } catch (cause) {
    throw new Error(
      '@atlas-os/platform is not resolvable from @atlas-os/core: ' + String(cause && cause.message),
    );
  }
  adopt('platform', platformEntry);

  for (const localName of Object.keys(policy)) {
    if (!discovered.has(localName)) {
      throw new Error('local workspace package not inspected: @atlas-os/' + localName);
    }
  }
  return discovered;
}

/**
 * Decides whether one local workspace package's deployed payload is acceptable.
 *
 * Takes an already-collected description rather than reading the filesystem, so the policy is
 * decided by the same code in a unit test and inside a runtime image.
 */
export function checkLocalPackagePayload(localName, observed, policy = LOCAL_PACKAGE_POLICY) {
  const label = '@atlas-os/' + localName;
  const expected = policy[localName];
  if (expected === undefined) {
    throw new Error('unexpected local workspace package: ' + label);
  }

  const entries = [...observed.entries].sort();
  if (JSON.stringify(entries) !== JSON.stringify(['dist', 'node_modules', 'package.json'])) {
    throw new Error('unexpected files in ' + label + ': ' + entries.join(','));
  }

  const nested = [...(observed.nodeModulesEntries ?? [])].sort();
  if (JSON.stringify(nested) !== JSON.stringify(['.bin'])) {
    throw new Error('unexpected node_modules payload in ' + label + ': ' + nested.join(','));
  }

  const shims = [...(observed.binEntries ?? [])].sort();
  if (JSON.stringify(shims) !== JSON.stringify([expected.dependency])) {
    throw new Error('unexpected executables in ' + label + ': ' + shims.join(','));
  }

  // A directory named like the shim would satisfy the listing while hiding arbitrary payload.
  if (observed.shimKind !== 'file' && observed.shimKind !== 'symlink') {
    throw new Error(
      label +
        ' shim ' +
        expected.dependency +
        ' must be a file or symbolic link, found ' +
        String(observed.shimKind),
    );
  }

  const declared = (observed.manifest?.dependencies ?? {})[expected.dependency];
  if (declared !== expected.version) {
    throw new Error(
      label +
        ' must declare ' +
        expected.dependency +
        '@' +
        expected.version +
        ' directly, found ' +
        String(declared),
    );
  }

  const deployed = observed.dependencyManifest;
  if (deployed === null || deployed === undefined) {
    throw new Error(label + ' shim ' + expected.dependency + ' has no deployed package');
  }
  if (deployed.name !== expected.dependency || deployed.version !== expected.version) {
    throw new Error(
      label +
        ' expects ' +
        expected.dependency +
        '@' +
        expected.version +
        ', deployed ' +
        String(deployed.name) +
        '@' +
        String(deployed.version),
    );
  }
}

/**
 * Proves the one production `@types` edge, and returns the store entry it justifies.
 *
 * Every link is checked: which package pulls the dependency in, at which version, the range it
 * declares, and what is actually installed. Anything else keeps the blanket `@types` ban.
 */
export function checkProductionTypeException(observed, exception = PRODUCTION_TYPE_EXCEPTION) {
  const parent = observed.parentManifest;
  if (parent === null || parent === undefined) {
    throw new Error(exception.parent.name + ' is not resolvable from @atlas-os/platform');
  }
  if (parent.name !== exception.parent.name || parent.version !== exception.parent.version) {
    throw new Error(
      'type exception expects ' +
        exception.parent.name +
        '@' +
        exception.parent.version +
        ', resolved ' +
        String(parent.name) +
        '@' +
        String(parent.version),
    );
  }

  const declared = (parent.dependencies ?? {})[exception.dependency.name];
  if (declared !== exception.dependency.range) {
    throw new Error(
      exception.parent.name +
        ' must declare ' +
        exception.dependency.name +
        ': ' +
        exception.dependency.range +
        ', found ' +
        String(declared),
    );
  }

  const dependency = observed.dependencyManifest;
  if (dependency === null || dependency === undefined) {
    throw new Error(exception.dependency.name + ' is not resolvable from ' + exception.parent.name);
  }
  if (
    dependency.name !== exception.dependency.name ||
    dependency.version !== exception.dependency.version
  ) {
    throw new Error(
      'type exception expects ' +
        exception.dependency.name +
        '@' +
        exception.dependency.version +
        ', deployed ' +
        String(dependency.name) +
        '@' +
        String(dependency.version),
    );
  }

  return exception.storeEntry;
}

/**
 * Development packages found in a production store.
 *
 * `allowedEntries` holds only entries a caller has already proven, and each is matched in full:
 * a different version of the same package is still a leak.
 */
export function forbiddenStoreEntries(entries, allowedEntries = []) {
  const allowed = new Set(allowedEntries);
  return entries.filter((entry) => FORBIDDEN_STORE_PATTERN.test(entry) && !allowed.has(entry));
}

/**
 * The audit executed inside a runtime image.
 *
 * Only filesystem and resolver glue lives here; every policy decision is one of the exported
 * helpers above, serialised into this script so the image and the unit tests cannot drift apart.
 */
export function applicationAudit() {
  return String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const app = '/app';

const LOCAL_PACKAGE_POLICY = ${JSON.stringify(LOCAL_PACKAGE_POLICY)};
const PRODUCTION_TYPE_EXCEPTION = ${JSON.stringify(PRODUCTION_TYPE_EXCEPTION)};
const FORBIDDEN_STORE_PATTERN = ${FORBIDDEN_STORE_PATTERN.toString()};
const parentDirectory = ${parentDirectory.toString()};
const nearestPackageRoot = ${nearestPackageRoot.toString()};
const discoverLocalPackages = ${discoverLocalPackages.toString()};
const checkLocalPackagePayload = ${checkLocalPackagePayload.toString()};
const checkProductionTypeException = ${checkProductionTypeException.toString()};
const forbiddenStoreEntries = ${forbiddenStoreEntries.toString()};

const allowedRoot = new Set(['dist', 'node_modules', 'package.json']);
const rootEntries = fs.readdirSync(app);
if (typeof process.getuid !== 'function' || process.getuid() === 0) {
  throw new Error('runtime process is not using a non-root UID');
}
for (const entry of rootEntries) {
  if (!allowedRoot.has(entry)) throw new Error('unexpected /app entry: ' + entry);
}
if (fs.existsSync('/workspace')) throw new Error('/workspace leaked into runtime image');
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
if (manifest.devDependencies) throw new Error('root devDependencies leaked into runtime image');

function readManifest(directory) {
  const candidate = path.join(directory, 'package.json');
  if (!fs.existsSync(candidate)) return null;
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch {
    return null;
  }
}
function resolveFrom(packageRoot, request) {
  return createRequire(path.join(packageRoot, 'package.json')).resolve(request);
}
function listing(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : null;
}
function shimKind(shimPath) {
  let stats;
  try {
    stats = fs.lstatSync(shimPath);
  } catch {
    return 'missing';
  }
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  return stats.isFile() ? 'file' : 'other';
}
// A package's own dependencies resolve from the directory holding it, so the deployed manifest is
// found by walking the node_modules chain the way Node would.
function deployedManifest(startDirectory, dependency) {
  let current = startDirectory;
  for (;;) {
    const candidates = [path.join(current, 'node_modules', dependency, 'package.json')];
    if (path.basename(current) === 'node_modules') {
      candidates.push(path.join(current, dependency, 'package.json'));
    }
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const discovered = discoverLocalPackages(
  {
    applicationEntry: (request) => createRequire(path.join(app, 'package.json')).resolve(request),
    readManifest,
    resolveFrom,
  },
  LOCAL_PACKAGE_POLICY,
);

const inspected = [];
for (const [localName, found] of discovered) {
  const localNodeModules = path.join(found.root, 'node_modules');
  const expected = LOCAL_PACKAGE_POLICY[localName];
  checkLocalPackagePayload(
    localName,
    {
      binEntries: listing(path.join(localNodeModules, '.bin')),
      dependencyManifest: deployedManifest(found.root, expected.dependency),
      entries: fs.readdirSync(found.root),
      manifest: found.manifest,
      nodeModulesEntries: listing(localNodeModules),
      shimKind: shimKind(path.join(localNodeModules, '.bin', expected.dependency)),
    },
    LOCAL_PACKAGE_POLICY,
  );
  inspected.push(localName);
}

// Prove the one production @types edge before excusing its store entry.
const platformRoot = discovered.get('platform').root;
let parentManifest = null;
let typeDependencyManifest = null;
try {
  const parentEntry = resolveFrom(platformRoot, PRODUCTION_TYPE_EXCEPTION.parent.name);
  parentManifest = (nearestPackageRoot(parentEntry, readManifest) || {}).manifest || null;
  if (parentManifest !== null) {
    const manifestPath = createRequire(parentEntry).resolve(
      PRODUCTION_TYPE_EXCEPTION.dependency.name + '/package.json',
    );
    typeDependencyManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
} catch (error) {
  throw new Error('production type exception could not be proven: ' + String(error && error.message));
}
const allowedStoreEntries = [
  checkProductionTypeException(
    { dependencyManifest: typeDependencyManifest, parentManifest },
    PRODUCTION_TYPE_EXCEPTION,
  ),
];

const pnpmRoot = path.join(app, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmRoot)) {
  const leaked = forbiddenStoreEntries(fs.readdirSync(pnpmRoot), allowedStoreEntries);
  if (leaked.length > 0) throw new Error('development dependencies leaked: ' + leaked.join(','));
}
for (const forbidden of ['.env', '.env.local', '.validation', 'docs', 'src', 'tests']) {
  if (fs.existsSync(path.join(app, forbidden))) throw new Error('forbidden app payload: ' + forbidden);
}
process.stdout.write(
  JSON.stringify({application: manifest.name, allowedStoreEntries, inspected, rootEntries}) + '\n',
);
`;
}

function docker(arguments_) {
  return spawnSync('docker', arguments_, { encoding: 'utf8', stdio: 'pipe' });
}

export function inspectRuntimeImages() {
  const images = ['atlas-os/api:m0', 'atlas-os/updater:m0'];
  const audit = applicationAudit();
  for (const image of images) {
    const result = docker(['run', '--rm', '--entrypoint', 'node', image, '-e', audit]);
    if (result.error || result.status !== 0) {
      throw new Error(
        `Runtime image audit failed for ${image}: ${result.error ?? ''}${result.stdout}${result.stderr}`,
      );
    }
    process.stdout.write(`${image}: ${result.stdout}`);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  inspectRuntimeImages();
}
