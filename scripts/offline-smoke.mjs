import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectRuntimeImages } from './inspect-runtime-images.mjs';

const root = resolve(import.meta.dirname, '..');
const composeFile = 'infra/compose/compose.yaml';
const project = 'atlas-os-m1-offline';
const gateway = 'http://127.0.0.1:8080';

function docker(arguments_, environment = process.env) {
  return spawnSync('docker', arguments_, { encoding: 'utf8', env: environment, stdio: 'pipe' });
}

/**
 * Returns 2, "unexecuted", when there is nothing to run the test against: no Compose client, or
 * a client without a reachable daemon. That is never a failure of the runtime under test.
 */
function preflight() {
  const version = docker(['compose', 'version']);
  if (version.error || version.status !== 0) {
    process.stderr.write(
      'Docker Compose is unavailable. Provision images with `pnpm compose:build`, then run `pnpm test:offline` on a Docker host.\n',
    );
    return 2;
  }
  const daemon = docker(['info', '--format', '{{.ServerVersion}}']);
  if (daemon.error || daemon.status !== 0) {
    process.stderr.write(
      'The Docker daemon is unreachable. Run `pnpm test:offline` on a host with a running Docker daemon.\n',
    );
    return 2;
  }
  return 0;
}

export const composeArguments = ['compose', '-f', composeFile, '-p', project];
const gatewayRetryTimeoutMs = 20_000;
const gatewayAttemptTimeoutMs = 2_000;
const gatewayRetryDelayMs = 250;

function writeCommandDiagnostics(label, result) {
  process.stderr.write(`\n${label}\n`);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function reportComposeDiagnostics(run, environment) {
  writeCommandDiagnostics(
    'docker compose ps --all',
    run([...composeArguments, 'ps', '--all'], environment),
  );
  writeCommandDiagnostics(
    'docker compose port gateway 8080',
    run([...composeArguments, 'port', 'gateway', '8080'], environment),
  );
  for (const service of ['gateway', 'web', 'api', 'updater', 'search-blue', 'search-green']) {
    writeCommandDiagnostics(
      `docker compose logs --no-color ${service}`,
      run([...composeArguments, 'logs', '--no-color', service], environment),
    );
  }
}

function reportComposeDiagnosticsWithoutThrowing(run, environment) {
  try {
    reportComposeDiagnostics(run, environment);
  } catch (error) {
    process.stderr.write(`Unable to collect Compose diagnostics: ${error.message}\n`);
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function request(path, options = {}) {
  const deadline = Date.now() + gatewayRetryTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      return await fetch(`${gateway}${path}`, {
        ...options,
        signal: AbortSignal.timeout(Math.max(1, Math.min(gatewayAttemptTimeoutMs, remaining))),
      });
    } catch (error) {
      lastError = error;
      const retryDelay = Math.min(gatewayRetryDelayMs, deadline - Date.now());
      if (retryDelay <= 0) break;
      await delay(retryDelay);
    }
  }
  throw new Error(`${path} was unreachable through the gateway after ${gatewayRetryTimeoutMs}ms.`, {
    cause: lastError,
  });
}

async function requireOk(path, options = {}) {
  const response = await request(path, options);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * The dataset fields a failure needs in order to be diagnosable, and nothing else.
 *
 * `reason` is what distinguishes a missing snapshot from an unreadable or mismatched one, and it
 * is absent on a healthy dataset. Only these public API fields are reported: never a filesystem
 * path, environment value or manifest body.
 */
function describeDataset(dataset) {
  const described = [`state=${String(dataset.state)}`];
  if (dataset.reason !== undefined && dataset.reason !== null) {
    described.push(`reason=${String(dataset.reason)}`);
  }
  if (dataset.snapshotId !== undefined && dataset.snapshotId !== null) {
    described.push(`snapshotId=${String(dataset.snapshotId)}`);
  }
  return described.join(', ');
}

/**
 * Provisions a snapshot on the host, exactly as an operator does, then starts the runtime with
 * that snapshot mounted read-only. The runtime itself never builds data. The snapshot carries the
 * synthetic search fixture, imported and proved by the real engine in the local images with no
 * network.
 */
function provisionSnapshot(dataRoot) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/provision-fixture.mjs'), dataRoot, '--search'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    throw new Error('Failed to provision the offline basemap fixture.');
  }
  return JSON.parse(result.stdout).snapshotId;
}

async function verifyRuntime(snapshotId) {
  const [web, health, readiness, dataset, basemap] = await Promise.all([
    requireOk('/').then((response) => response.text()),
    requireOk('/api/health').then((response) => response.json()),
    requireOk('/api/ready').then((response) => response.json()),
    requireOk('/api/v1/dataset').then((response) => response.json()),
    requireOk('/api/v1/basemap').then((response) => response.json()),
  ]);

  expect(web.includes('atlas-os'), 'Web application marker was not found.');
  expect(health.status === 'ok', 'API health payload was unexpected.');
  expect(readiness.ready === true, 'API readiness payload was unexpected.');
  expect(dataset.state === 'ready', `Dataset was not ready: ${describeDataset(dataset)}.`);
  expect(
    dataset.snapshotId === snapshotId,
    `Dataset reported snapshot ${dataset.snapshotId}, expected ${snapshotId}.`,
  );
  expect(basemap.availability === 'ready', 'Basemap descriptor was not ready.');
  expect(basemap.vectorFormat === 'mvt', 'Basemap did not report vector tile data.');
  expect(
    basemap.mediaType === 'application/vnd.pmtiles',
    'Basemap did not report the archive media type.',
  );

  // A byte-range read of the archive through the gateway.
  const ranged = await request(basemap.resourceUrl, { headers: { range: 'bytes=0-126' } });
  expect(ranged.status === 206, `Ranged archive read returned HTTP ${ranged.status}.`);
  expect(
    ranged.headers.get('accept-ranges') === 'bytes',
    'Ranged response did not advertise byte ranges.',
  );
  expect(
    ranged.headers.get('content-range')?.startsWith('bytes 0-126/'),
    `Ranged response had content range ${ranged.headers.get('content-range')}.`,
  );
  const archiveHead = Buffer.from(await ranged.arrayBuffer());
  expect(archiveHead.length === 127, `Ranged read returned ${archiveHead.length} bytes.`);
  expect(
    archiveHead.subarray(0, 7).toString('ascii') === 'PMTiles',
    'Ranged read did not return the archive header.',
  );

  const unsatisfiable = await request(basemap.resourceUrl, {
    headers: { range: 'bytes=99999999999-99999999999' },
  });
  expect(
    unsatisfiable.status === 416,
    `Unsatisfiable range returned HTTP ${unsatisfiable.status}, expected 416.`,
  );

  // Local style, glyph and sprite resources.
  const style = await requireOk(basemap.styleDescriptorUrl).then((response) => response.json());
  expect(style.version === 8, 'Style document was not a version 8 style.');

  // The offline guarantee is about what the renderer fetches. Attribution is required to carry
  // hyperlinks to the projects whose data and schema the map uses; those are navigational and
  // are never requested while rendering, so a blanket ban on every URL would force a choice
  // between correct licensing and a meaningful offline guarantee.
  const fetched = [style.glyphs, style.sprite];
  for (const source of Object.values(style.sources ?? {})) {
    if (typeof source?.url === 'string') fetched.push(source.url);
    for (const tile of source?.tiles ?? []) fetched.push(tile);
  }
  for (const url of fetched.filter((value) => typeof value === 'string')) {
    const local = url.startsWith('pmtiles:///') || (url.startsWith('/') && !url.startsWith('//'));
    expect(local, `Style fetches a resource outside this deployment: ${url}`);
  }

  const attributions = Object.values(style.sources ?? {})
    .map((source) => source?.attribution)
    .filter((value) => typeof value === 'string' && value.length > 0);
  expect(attributions.length > 0, 'Style declares no attribution.');
  expect(
    attributions.some((value) => value === basemap.attribution),
    'Style attribution does not match the basemap descriptor.',
  );

  const glyphUrl = basemap.glyphUrlTemplate
    .replace('{fontstack}', 'atlas-os-regular')
    .replace('{range}', '1536-1791');
  const glyphs = await requireOk(glyphUrl);
  expect(
    glyphs.headers.get('content-type') === 'application/x-protobuf',
    'Glyph range had an unexpected content type.',
  );
  expect((await glyphs.arrayBuffer()).byteLength > 0, 'Glyph range was empty.');

  const sprite = await requireOk(`${basemap.spriteUrl}.png`);
  expect(sprite.headers.get('content-type') === 'image/png', 'Sprite sheet was not a PNG.');
  await requireOk(`${basemap.spriteUrl}.json`);

  // Traversal must be refused through the gateway as well as in process.
  const traversal = await request(`/maps/v1/${snapshotId}/%2e%2e%2f%2e%2e%2fmanifest.json`);
  expect(
    traversal.status === 400 || traversal.status === 404,
    `Traversal attempt returned HTTP ${traversal.status}.`,
  );

  // The right-to-left shaping plugin is served from this origin, not a plugin host.
  const plugin = await requireOk('/vendor/mapbox-gl-rtl-text.js');
  expect((await plugin.text()).length > 0, 'Right-to-left text plugin was empty.');
}

/** Provider and private-protocol vocabulary that must never reach a public response. */
const PRIVATE =
  /photon|nominatim|opensearch|komoot|osm_type|place_id|x-atlas|atlas_generation|loadId/i;

async function waitForSearch(snapshotId) {
  const deadline = Date.now() + 300_000;
  let last;
  while (Date.now() < deadline) {
    last = await requireOk('/api/v1/dataset').then((response) => response.json());
    if (last.search?.state === 'ready' && last.search.snapshotId === snapshotId) return;
    await delay(1_000);
  }
  throw new Error(`Search did not become ready: ${JSON.stringify(last?.search ?? null)}.`);
}

async function verifySearch(snapshotId) {
  await waitForSearch(snapshotId);

  const capabilities = await requireOk('/api/v1/capabilities').then((response) => response.json());
  expect(
    capabilities.features.search.available === true &&
      capabilities.features.reverse_geocoding.available === true,
    'Capabilities did not report search and reverse geocoding.',
  );

  const search = await requireOk(`/api/v1/search?q=${encodeURIComponent('تهران')}`);
  expect(search.headers.get('cache-control') === 'no-store', 'Search response was cacheable.');
  const searchBody = await search.text();
  const found = JSON.parse(searchBody);
  expect(found.snapshotId === snapshotId, `Search answered from ${found.snapshotId}.`);
  expect(
    found.results[0]?.id === 'osm:node:8000000000000001',
    `Search returned ${JSON.stringify(found.results[0])}.`,
  );
  expect(found.attribution?.licence === 'none', 'Synthetic search claimed map data attribution.');
  expect(!PRIVATE.test(searchBody), 'Search response leaked private or provider vocabulary.');

  const canonical = await requireOk(`/api/v1/search?q=${encodeURIComponent('كتابخانه ملي')}`).then(
    (response) => response.json(),
  );
  expect(
    canonical.results[0]?.id === 'osm:node:8000000000000010',
    'Arabic letter variants did not reach the canonical Persian name.',
  );

  const reverse = await requireOk('/api/v1/reverse?lat=35.7002&lon=51.3605');
  const reverseBody = await reverse.text();
  const described = JSON.parse(reverseBody);
  expect(
    described.results[0]?.id === 'osm:node:8000000000000009',
    `Reverse returned ${JSON.stringify(described.results[0])}.`,
  );
  expect(!PRIVATE.test(reverseBody), 'Reverse response leaked private or provider vocabulary.');

  const invalid = await request('/api/v1/search?q=ab&q=cd');
  expect(invalid.status === 400, `Duplicated parameter returned HTTP ${invalid.status}.`);
  const mutation = await request('/api/v1/search?q=ab', { method: 'POST' });
  expect(mutation.status === 404, `A mutation on the search route returned ${mutation.status}.`);
}

/**
 * The engine inside each search host is reachable from nowhere else: only the host's private
 * port answers on the runtime network, and the slots are read-only inside the host.
 */
function verifySearchIsolation(environment) {
  const probe = String.raw`
const net = require('node:net');
const attempt = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port, timeout: 2000 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
});
(async () => {
  for (const host of ['search-blue', 'search-green']) {
    if (!(await attempt(host, 2322))) throw new Error(host + ' host port is unreachable');
    for (const port of [2321, 9200, 9201, 9300]) {
      if (await attempt(host, port)) throw new Error(host + ':' + port + ' is reachable');
    }
  }
})().catch((error) => { console.error(error.message); process.exit(1); });
`;
  const isolated = docker(
    [...composeArguments, 'exec', '--no-TTY', 'api', 'node', '-e', probe],
    environment,
  );
  if (isolated.status !== 0) {
    throw new Error(`Search engine isolation failed: ${isolated.stdout}${isolated.stderr}`);
  }

  for (const service of ['search-blue', 'search-green']) {
    const write = docker(
      [
        ...composeArguments,
        'exec',
        '--no-TTY',
        service,
        'node',
        '-e',
        "require('node:fs').writeFileSync('/var/lib/atlas/probe', 'x')",
      ],
      environment,
    );
    if (write.status === 0) throw new Error(`${service} could write to the dataset.`);
    const published = docker([...composeArguments, 'port', service, '2322'], environment);
    if (published.status === 0 && published.stdout.trim().length > 0) {
      throw new Error(`${service} publishes a port: ${published.stdout.trim()}`);
    }
  }
}

function verifyUpdaterOffline(environment) {
  const updater = docker(
    [
      ...composeArguments,
      'exec',
      '--no-TTY',
      'updater',
      'node',
      '-e',
      "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(j=>{if(j.status!=='ok'||j.updateConnectivity!=='offline')process.exit(1)}).catch(()=>process.exit(1))",
    ],
    environment,
  );
  if (updater.status !== 0) {
    throw new Error(`Updater offline health check failed: ${updater.stdout}${updater.stderr}`);
  }
}

/**
 * Removes everything the test created: containers, networks, named volumes and the host data
 * directory. Returns whether all of it went; every failure is reported with its output.
 */
async function tearDown(run, environment, dataRoot) {
  let clean = true;
  const down = run([...composeArguments, 'down', '--volumes', '--remove-orphans'], environment);
  if (down.error || down.status !== 0) {
    writeCommandDiagnostics('docker compose down --volumes --remove-orphans failed', down);
    clean = false;
  }
  try {
    await rm(dataRoot, { force: true, recursive: true });
  } catch (error) {
    process.stderr.write(`Unable to remove the offline test data: ${error.message}\n`);
    clean = false;
  }
  return clean;
}

/**
 * Starts the runtime, runs every check and always tears everything down again.
 *
 * Returns the exit status, or rethrows the first failure. A startup or check failure is the
 * primary result even when cleanup fails too, which is still reported. A cleanup failure after
 * passing checks fails the run: a gate that leaves containers or volumes behind has not passed.
 */
export async function runOfflineSmoke({
  run,
  dataRoot,
  environment,
  inspect,
  provision,
  verify,
  write = (text) => process.stdout.write(text),
}) {
  let startupStatus = 0;
  let containersStarted = false;
  let failed = false;
  let failure;

  try {
    inspect();
    const snapshotId = provision(dataRoot);
    write(`Provisioned offline fixture snapshot ${snapshotId}.\n`);

    const up = run([...composeArguments, 'up', '--detach', '--no-build', '--wait'], environment);
    if (up.status !== 0) {
      process.stderr.write(`${up.stdout ?? ''}${up.stderr ?? ''}`);
      reportComposeDiagnosticsWithoutThrowing(run, environment);
      startupStatus = up.status ?? 1;
    } else {
      containersStarted = true;
      await verify(snapshotId, environment);
    }
  } catch (error) {
    if (containersStarted) reportComposeDiagnosticsWithoutThrowing(run, environment);
    failed = true;
    failure = error;
  }

  const clean = await tearDown(run, environment, dataRoot);
  if (!clean && (failed || startupStatus !== 0)) {
    process.stderr.write('Cleanup failed as well; the failure above is the primary result.\n');
  }
  if (failed) throw failure;
  if (startupStatus !== 0) return startupStatus;
  if (!clean) {
    process.stderr.write(
      'Every offline check passed, but cleanup failed: containers, networks or volumes may remain. The offline smoke test did not pass.\n',
    );
    return 1;
  }
  write(
    'Offline smoke test passed: gateway, Web map, API, ranged archive reads, local style, glyphs and sprites, Persian search and reverse geocoding from isolated per-slot engines, an offline updater, and a complete cleanup.\n',
  );
  return 0;
}

async function main() {
  const unexecuted = preflight();
  if (unexecuted !== 0) return unexecuted;
  const dataRoot = await mkdtemp(join(tmpdir(), 'atlas-os-offline-'));
  return runOfflineSmoke({
    dataRoot,
    environment: { ...process.env, ATLAS_DATA_ROOT: dataRoot },
    inspect: inspectRuntimeImages,
    provision: provisionSnapshot,
    run: docker,
    verify: async (snapshotId, environment) => {
      await verifyRuntime(snapshotId);
      await verifySearch(snapshotId);
      verifySearchIsolation(environment);
      verifyUpdaterOffline(environment);
    },
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
