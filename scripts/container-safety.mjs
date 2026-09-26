import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requiredDockerIgnoreRules = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '!.env.example',
  '!**/.env.example',
  '.validation',
  '.validation/**',
  'outputs',
  'work',
  '*.diff',
  '*.patch',
  'coverage',
  '**/coverage',
  'docs',
  'tests',
];

export const requiredNginxRuntimeDirectives = [
  'pid /tmp/nginx.pid;',
  'client_body_temp_path /tmp/client_temp;',
  'proxy_temp_path /tmp/proxy_temp;',
  'fastcgi_temp_path /tmp/fastcgi_temp;',
  'uwsgi_temp_path /tmp/uwsgi_temp;',
  'scgi_temp_path /tmp/scgi_temp;',
];

export function checkNginxRuntimeConfig(configuration, configPath) {
  for (const directive of requiredNginxRuntimeDirectives) {
    if (!configuration.includes(directive)) {
      throw new Error(`${configPath} is missing required runtime directive: ${directive}`);
    }
  }
}

export const requiredGatewayResourceDirectives = [
  'location /maps/',
  'proxy_set_header Range $http_range;',
  'proxy_buffering off;',
];

/**
 * The gateway must forward byte-range requests and stream the response. Buffering a ranged read
 * of a large archive would fill the gateway's bounded temporary filesystem.
 */
export function checkGatewayResourceRouting(configuration) {
  for (const directive of requiredGatewayResourceDirectives) {
    if (!configuration.includes(directive)) {
      throw new Error(`Gateway is missing required resource directive: ${directive}`);
    }
  }
}

/**
 * The dataset must be mounted read-only into every request-serving service, so a serving
 * process cannot modify, replace or delete the snapshot it is publishing.
 */
export function checkDatasetMountsAreReadOnly(compose) {
  const mounts = [
    ...compose.matchAll(/^ {6}- \$\{ATLAS_DATA_ROOT:[^}]*\}:(\/[^:\s]+)(:[a-z,]+)?$/gm),
  ];
  if (mounts.length === 0) throw new Error('Compose does not mount the dataset into any service.');
  for (const mount of mounts) {
    if (mount[2] !== ':ro') {
      throw new Error(`Dataset mount at ${mount[1]} must be read-only.`);
    }
  }
  return mounts.length;
}

function yamlBlock(source, key, indentation) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const marker = `${' '.repeat(indentation)}${key}:`;
  const start = lines.findIndex((line) => line === marker);
  if (start === -1) throw new Error(`Compose is missing ${key}.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces <= indentation) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function serviceList(compose, service, key) {
  const block = yamlBlock(compose, service, 2);
  const marker = `${' '.repeat(4)}${key}:`;
  const start = block.findIndex((line) => line.startsWith(marker));
  if (start === -1) return null;
  const inline = block[start].slice(marker.length).trim();
  if (inline.startsWith('[') && inline.endsWith(']')) {
    return inline
      .slice(1, -1)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  const entries = [];
  for (let index = start + 1; index < block.length; index += 1) {
    const match = block[index].match(/^ {6}-\s+(.+)$/);
    if (!match) break;
    entries.push(match[1]);
  }
  return entries;
}

export function checkComposeNetworkPolicy(compose) {
  const runtime = yamlBlock(compose, 'runtime', 2);
  if (!runtime.some((line) => /^ {4}internal:\s*true\s*$/.test(line))) {
    throw new Error('Compose runtime network must remain internal.');
  }

  const edge = yamlBlock(compose, 'edge', 2);
  if (edge.some((line) => /^ {4}internal:\s*true\s*$/.test(line))) {
    throw new Error('Compose edge network must not be internal.');
  }
  if (!edge.some((line) => /^ {4}driver:\s*bridge\s*$/.test(line))) {
    throw new Error('Compose edge network must use the bridge driver.');
  }

  for (const service of ['api', 'web', 'updater', ...SEARCH_SERVICES]) {
    const networks = serviceList(compose, service, 'networks');
    if (JSON.stringify(networks) !== JSON.stringify(['runtime'])) {
      throw new Error(`Compose ${service} service must attach only to runtime.`);
    }
    if (serviceList(compose, service, 'ports') !== null) {
      throw new Error(`Compose ${service} service must not publish ports.`);
    }
  }

  const gatewayNetworks = serviceList(compose, 'gateway', 'networks');
  if (JSON.stringify(gatewayNetworks) !== JSON.stringify(['edge', 'runtime'])) {
    throw new Error('Compose gateway service must attach only to edge and runtime.');
  }
  const gatewayPorts = serviceList(compose, 'gateway', 'ports');
  const expectedPort = "'127.0.0.1:${ATLAS_GATEWAY_PORT:-8080}:8080'";
  if (JSON.stringify(gatewayPorts) !== JSON.stringify([expectedPort])) {
    throw new Error('Compose gateway port must publish only on 127.0.0.1.');
  }
}

/** One private search host per slot. */
export const SEARCH_SERVICES = ['search-blue', 'search-green'];

function serviceScalar(compose, service, key) {
  const block = yamlBlock(compose, service, 2);
  const line = block.find((entry) => entry.startsWith(`${' '.repeat(4)}${key}:`));
  return line === undefined ? null : line.slice(4 + key.length + 1).trim();
}

function serviceEnvironment(compose, service) {
  const block = yamlBlock(compose, service, 2);
  const start = block.findIndex((line) => line === '    environment:');
  if (start === -1) return {};
  const environment = {};
  for (let index = start + 1; index < block.length; index += 1) {
    const match = block[index].match(/^ {6}([A-Z0-9_]+):\s*(.*)$/);
    if (!match) break;
    environment[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
  }
  return environment;
}

/**
 * Each search host serves exactly its own slot from the read-only dataset, keeps its working
 * copy only in its own named volume, and is reachable only by name on the internal network.
 * The provisioning image, which carries the database build tools, is never a Compose service.
 */
export function checkSearchServices(compose) {
  if (/search-build/.test(compose)) {
    throw new Error('The search provisioning image must never be a Compose service.');
  }
  const volumes = yamlBlock(compose, 'volumes', 0);
  const api = serviceEnvironment(compose, 'api');
  for (const service of SEARCH_SERVICES) {
    const slot = service.slice('search-'.length);
    if (serviceScalar(compose, service, 'image') !== 'atlas-os/search:m2') {
      throw new Error(`Compose ${service} must run the search serving image.`);
    }
    if (!yamlBlock(compose, service, 2).includes('      target: search-runtime')) {
      throw new Error(`Compose ${service} must build the search-runtime stage.`);
    }
    if (serviceEnvironment(compose, service).ATLAS_SEARCH_SLOT !== slot) {
      throw new Error(`Compose ${service} must serve only the ${slot} slot.`);
    }
    const mounts = serviceList(compose, service, 'volumes') ?? [];
    const work = `${service}-work:/var/lib/atlas-engine`;
    const dataset = '${ATLAS_DATA_ROOT:-../../data}:/var/lib/atlas:ro';
    if (JSON.stringify(mounts) !== JSON.stringify([dataset, work])) {
      throw new Error(
        `Compose ${service} must mount only the read-only dataset and its own work volume.`,
      );
    }
    if (!volumes.includes(`  ${service}-work:`)) {
      throw new Error(`Compose must declare the named volume ${service}-work.`);
    }
    // Bounded, operator-set hard limits: memory with no swap beyond it, and a PID ceiling.
    const memory = serviceScalar(compose, service, 'mem_limit');
    if (!/^\$\{ATLAS_SEARCH_HOST_MEMORY_LIMIT:-[1-9][0-9]{0,5}[mg]\}$/.test(memory ?? '')) {
      throw new Error(
        `Compose ${service} must set a bounded memory limit from ATLAS_SEARCH_HOST_MEMORY_LIMIT.`,
      );
    }
    if (serviceScalar(compose, service, 'memswap_limit') !== memory) {
      throw new Error(`Compose ${service} must not swap beyond its memory limit.`);
    }
    if (
      !/^\$\{ATLAS_SEARCH_HOST_PIDS_LIMIT:-[1-9][0-9]{0,5}\}$/.test(
        serviceScalar(compose, service, 'pids_limit') ?? '',
      )
    ) {
      throw new Error(
        `Compose ${service} must set a bounded PID limit from ATLAS_SEARCH_HOST_PIDS_LIMIT.`,
      );
    }
    const url = api[`ATLAS_SEARCH_ENGINE_${slot.toUpperCase()}_URL`];
    if (url !== `http://${service}:2322`) {
      throw new Error(`Compose api must reach the ${slot} search host by name on the host port.`);
    }
  }
}

/**
 * The search serving image carries the compiled host, the runtime and the verified engine
 * archive, and nothing used to build either the host or a search database.
 */
export function checkSearchImage(dockerfile) {
  const stage = runtimeStage(dockerfile, 'search-runtime');
  for (const required of [
    'COPY --from=search-host-deploy /prod/search-host/ ./',
    'COPY --from=jre /opt/java/openjdk /opt/java/openjdk',
    'COPY --from=engine-archive /engine.jar /opt/atlas-os/engine/engine.jar',
    'USER 10001:10001',
    'CMD ["node", "dist/index.js"]',
  ]) {
    if (!stage.includes(required)) throw new Error(`search-runtime must include: ${required}`);
  }
  for (const forbidden of [
    '/workspace',
    'COPY . ',
    'pnpm',
    'corepack',
    'apt-get',
    'postgres',
    'osm2pgsql',
    'nominatim',
    'python',
    'search-build',
  ]) {
    if (stage.toLowerCase().includes(forbidden)) {
      throw new Error(`search-runtime contains forbidden runtime content: ${forbidden}`);
    }
  }
  if (
    !dockerfile.includes(
      'a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5  /engine.jar',
    ) ||
    !dockerfile.includes('test "$(stat -c %s /engine.jar)" = "98219380"')
  ) {
    throw new Error('The engine archive must be verified by its pinned digest and size.');
  }
}

export function isForbiddenBuildContextPath(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const name = normalized.split('/').at(-1) ?? normalized;
  if (name === '.env.example') return false;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (
    normalized === '.validation' ||
    normalized.startsWith('.validation/') ||
    normalized === 'outputs' ||
    normalized.startsWith('outputs/') ||
    normalized === 'work' ||
    normalized.startsWith('work/') ||
    normalized === 'coverage' ||
    normalized.startsWith('coverage/') ||
    normalized.includes('/coverage/') ||
    normalized === 'docs' ||
    normalized.startsWith('docs/') ||
    normalized === 'tests' ||
    normalized.startsWith('tests/')
  ) {
    return true;
  }
  return name.endsWith('.diff') || name.endsWith('.patch') || name.endsWith('.log');
}

function runtimeStage(dockerfile, stageName) {
  const marker = `FROM \${NODE_IMAGE} AS ${stageName}`;
  const start = dockerfile.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${stageName} stage.`);
  const next = dockerfile.indexOf('\nFROM ', start + marker.length);
  return dockerfile.slice(start + marker.length, next === -1 ? undefined : next);
}

export async function checkContainerSafety(root = process.cwd()) {
  const dockerignore = await readFile(resolve(root, '.dockerignore'), 'utf8');
  const rules = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  for (const required of requiredDockerIgnoreRules) {
    if (!rules.includes(required)) throw new Error(`.dockerignore is missing ${required}`);
  }
  if (rules.indexOf('!.env.example') < rules.indexOf('.env.*')) {
    throw new Error('.env.example must be restored after the .env.* exclusion.');
  }

  for (const forbidden of [
    '.env',
    '.env.local',
    'apps/api/.env.production',
    '.validation/results.json',
    'outputs/review.md',
    'work/cache/file',
    'coverage/lcov.info',
    'docs/architecture.md',
    'tests/unit/example.test.ts',
    'review.patch',
    'atlas-os.diff',
  ]) {
    if (!isForbiddenBuildContextPath(forbidden)) {
      throw new Error(`Forbidden build-context path was not rejected: ${forbidden}`);
    }
  }
  if (isForbiddenBuildContextPath('.env.example')) {
    throw new Error('.env.example must remain available to the build context.');
  }

  const serverDockerfile = await readFile(resolve(root, 'infra/images/server.Dockerfile'), 'utf8');
  for (const [stageName, deployment] of [
    ['api-runtime', 'api-deploy'],
    ['updater-runtime', 'updater-deploy'],
  ]) {
    const stage = runtimeStage(serverDockerfile, stageName);
    if (!stage.includes(`COPY --from=${deployment} --chown=node:node /prod/`)) {
      throw new Error(`${stageName} must copy only its pnpm production deployment.`);
    }
    if (!stage.includes('CMD ["node", "dist/index.js"]')) {
      throw new Error(`${stageName} must run compiled output directly with Node.`);
    }
    if (!stage.includes('USER node')) {
      throw new Error(`${stageName} must run as the non-root node user.`);
    }
    for (const forbidden of ['/workspace', 'COPY .', 'pnpm', 'corepack']) {
      if (stage.includes(forbidden)) {
        throw new Error(`${stageName} contains forbidden runtime content: ${forbidden}`);
      }
    }
  }

  checkSearchImage(await readFile(resolve(root, 'infra/images/search.Dockerfile'), 'utf8'));

  const compose = await readFile(resolve(root, 'infra/compose/compose.yaml'), 'utf8');
  checkComposeNetworkPolicy(compose);
  checkSearchServices(compose);
  for (const target of ['target: api-runtime', 'target: updater-runtime']) {
    if (!compose.includes(target)) throw new Error(`Compose is missing ${target}.`);
  }
  // Counted against the declared services rather than a fixed number, so adding a service
  // cannot silently skip a hardening control.
  const serviceCount = yamlBlock(compose, 'services', 0).filter((line) =>
    /^ {2}[a-z][\w-]*:$/.test(line),
  ).length;
  for (const control of [
    'cap_drop: [ALL]',
    'security_opt: [no-new-privileges:true]',
    'read_only: true',
  ]) {
    const actualCount = compose.split(control).length - 1;
    if (actualCount !== serviceCount) {
      throw new Error(
        `Compose must apply ${control} to all ${serviceCount} services; found ${actualCount}.`,
      );
    }
  }
  if (/\bprivileged:\s*true\b/.test(compose)) {
    throw new Error('Compose must not enable privileged containers.');
  }

  for (const configPath of ['infra/images/web-nginx.conf', 'infra/gateway/nginx.conf']) {
    const configuration = await readFile(resolve(root, configPath), 'utf8');
    checkNginxRuntimeConfig(configuration, configPath);
  }
  checkGatewayResourceRouting(await readFile(resolve(root, 'infra/gateway/nginx.conf'), 'utf8'));
  checkDatasetMountsAreReadOnly(compose);

  for (const manifestPath of [
    'apps/api/package.json',
    'apps/search-host/package.json',
    'apps/updater/package.json',
    'packages/core/package.json',
    'packages/atlas-os/package.json',
  ]) {
    const manifest = JSON.parse(await readFile(resolve(root, manifestPath), 'utf8'));
    if (JSON.stringify(manifest.files) !== JSON.stringify(['dist'])) {
      throw new Error(`${manifestPath} must publish only dist.`);
    }
  }
}
