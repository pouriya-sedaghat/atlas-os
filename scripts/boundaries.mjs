import { readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const sourceExtension = /\.(?:ts|tsx|mts|cts)$/;
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function workspaceIdentity(relativePath) {
  const normalized = relativePath.split(sep).join('/').replaceAll('\\', '/');
  const [parent, name] = normalized.split('/');
  if (parent === 'apps' && name !== undefined && name.length > 0) {
    return { layer: 'app', unit: `apps/${name}` };
  }
  if (normalized === 'packages/core' || normalized.startsWith('packages/core/')) {
    return { layer: 'core', unit: 'packages/core' };
  }
  if (normalized === 'packages/atlas-os' || normalized.startsWith('packages/atlas-os/')) {
    return { layer: 'platform', unit: 'packages/atlas-os' };
  }
  return { layer: 'unknown', unit: null };
}

function matchesPackageSpecifier(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function importedWorkspace(specifier, workspaces) {
  for (const [packageName, workspace] of workspaces) {
    if (matchesPackageSpecifier(specifier, packageName)) return workspace;
  }
  if (matchesPackageSpecifier(specifier, '@atlas-os/platform')) {
    return { layer: 'platform', unit: 'packages/atlas-os' };
  }
  if (matchesPackageSpecifier(specifier, '@atlas-os/core')) {
    return { layer: 'core', unit: 'packages/core' };
  }
  return { layer: 'unknown', unit: null };
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      return sourceExtension.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

export function analyzeImport({
  importerLayer,
  importerPath,
  root = process.cwd(),
  specifier,
  workspaces = new Map(),
}) {
  const violations = [];
  const importerAbsolute = isAbsolute(importerPath) ? importerPath : resolve(root, importerPath);
  const importerWorkspace = workspaceIdentity(relative(root, importerAbsolute));
  let targetWorkspace = importedWorkspace(specifier, workspaces);
  const isRelativeImport = specifier.startsWith('.');
  let crossesWorkspaceUnit = false;
  if (isRelativeImport) {
    const targetAbsolute = resolve(dirname(importerAbsolute), specifier);
    targetWorkspace = workspaceIdentity(relative(root, targetAbsolute));
    crossesWorkspaceUnit =
      importerWorkspace.unit !== null &&
      targetWorkspace.unit !== null &&
      importerWorkspace.unit !== targetWorkspace.unit;
    if (crossesWorkspaceUnit) {
      violations.push(
        `${importerPath}: cross-workspace relative import ${specifier} bypasses the public package API`,
      );
    }
  }

  const targetLayer = targetWorkspace.layer;
  if (importerLayer === 'app' && targetLayer === 'platform') {
    violations.push(
      `${importerPath}: applications must import @atlas-os/core, not @atlas-os/platform`,
    );
  }
  if (importerLayer === 'platform' && targetLayer === 'core') {
    violations.push(`${importerPath}: the platform must not import @atlas-os/core`);
  }
  if (importerLayer === 'core' && targetLayer === 'app') {
    violations.push(`${importerPath}: core must not import an application`);
  }
  if (importerLayer === 'platform' && targetLayer === 'app') {
    violations.push(`${importerPath}: the platform must not import an application`);
  }
  if (
    importerLayer === 'app' &&
    targetLayer === 'app' &&
    (!isRelativeImport || crossesWorkspaceUnit)
  ) {
    violations.push(`${importerPath}: applications must not depend on another application`);
  }
  // Provider-specific implementation lives under the platform package's private tree. Reaching
  // into it from anywhere else would bypass the public contracts, whether by package specifier
  // or by a relative path that climbs out of the importing workspace.
  const isPrivatePlatformImport =
    /(?:^|\/)internal(?:\/|$)/.test(specifier) ||
    /(?:^|\/)providers(?:\/|$)/.test(specifier) ||
    matchesPackageSpecifier(specifier, '@atlas-os/platform/internal');
  if (importerLayer !== 'platform' && isPrivatePlatformImport) {
    violations.push(`${importerPath}: provider-specific modules are private to packages/atlas-os`);
  }
  return violations;
}

export function validateWorkspaceGraph(packages) {
  const violations = [];
  const localNames = new Set(packages.map((entry) => entry.name));
  const edges = new Map(packages.map((entry) => [entry.name, []]));

  for (const entry of packages) {
    for (const field of dependencyFields) {
      const dependencies = entry.manifest[field] ?? {};
      for (const dependency of Object.keys(dependencies)) {
        if (!localNames.has(dependency)) continue;
        edges.get(entry.name).push(dependency);
        if (entry.layer === 'app' && dependency !== '@atlas-os/core') {
          violations.push(
            `${entry.name}: application has forbidden local dependency ${dependency}`,
          );
        }
        if (entry.layer === 'core' && dependency !== '@atlas-os/platform') {
          violations.push(`${entry.name}: core has forbidden local dependency ${dependency}`);
        }
        if (entry.layer === 'platform') {
          violations.push(`${entry.name}: platform has forbidden local dependency ${dependency}`);
        }
      }
    }
  }

  const visited = new Set();
  const active = new Set();
  function visit(name, trail) {
    if (active.has(name)) {
      violations.push(`cyclic workspace dependency: ${[...trail, name].join(' -> ')}`);
      return;
    }
    if (visited.has(name)) return;
    active.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...trail, name]);
    active.delete(name);
    visited.add(name);
  }
  for (const name of edges.keys()) visit(name, []);
  return violations;
}

export async function checkBoundaries(root) {
  const packages = [];
  for (const parent of ['apps', 'packages']) {
    const parentDirectory = resolve(root, parent);
    for (const entry of await readdir(parentDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(parentDirectory, entry.name);
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
      packages.push({
        directory,
        layer: workspaceIdentity(relative(root, directory)).layer,
        manifest,
        name: manifest.name,
        unit: relative(root, directory).split(sep).join('/'),
      });
    }
  }

  const violations = validateWorkspaceGraph(packages);
  const workspaces = new Map(
    packages.map((entry) => [entry.name, { layer: entry.layer, unit: entry.unit }]),
  );
  for (const entry of packages) {
    const sourceDirectory = resolve(entry.directory, 'src');
    for (const path of await filesUnder(sourceDirectory)) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        if (specifier === undefined) continue;
        violations.push(
          ...analyzeImport({
            importerLayer: entry.layer,
            importerPath: relative(root, path),
            root,
            specifier,
            workspaces,
          }),
        );
      }
    }
  }
  return violations;
}
