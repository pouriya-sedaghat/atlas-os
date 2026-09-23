import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { inspectRuntimeImages } from './inspect-runtime-images.mjs';

const root = resolve(import.meta.dirname, '..');
const composeFile = 'infra/compose/compose.yaml';
const project = 'atlas-os-m1-offline';
const gateway = 'http://127.0.0.1:8080';

function docker(arguments_, environment = process.env) {
  return spawnSync('docker', arguments_, { encoding: 'utf8', env: environment, stdio: 'pipe' });
}

const version = docker(['compose', 'version']);
if (version.error || version.status !== 0) {
  process.stderr.write(
    'Docker Compose is unavailable. Provision images with `pnpm compose:build`, then run `pnpm test:offline` on a Docker host.\n',
  );
  process.exit(2);
}

const composeArguments = ['compose', '-f', composeFile, '-p', project];
const gatewayRetryTimeoutMs = 20_000;
const gatewayAttemptTimeoutMs = 2_000;
const gatewayRetryDelayMs = 250;

function writeCommandDiagnostics(label, result) {
  process.stderr.write(`\n${label}\n`);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function reportComposeDiagnostics(environment) {
  writeCommandDiagnostics(
    'docker compose ps --all',
    docker([...composeArguments, 'ps', '--all'], environment),
  );
  writeCommandDiagnostics(
    'docker compose port gateway 8080',
    docker([...composeArguments, 'port', 'gateway', '8080'], environment),
  );
  for (const service of ['gateway', 'web', 'api', 'updater']) {
    writeCommandDiagnostics(
      `docker compose logs --no-color ${service}`,
      docker([...composeArguments, 'logs', '--no-color', service], environment),
    );
  }
}

function reportComposeDiagnosticsWithoutThrowing(environment) {
  try {
    reportComposeDiagnostics(environment);
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
 * Provisions a basemap snapshot on the host, exactly as an operator does, then starts the
 * runtime with that snapshot mounted read-only. The runtime itself never builds data.
 */
function provisionSnapshot(dataRoot) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/provision-fixture.mjs'), dataRoot],
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

async function main() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'atlas-os-offline-'));
  const environment = { ...process.env, ATLAS_DATA_ROOT: dataRoot };
  let startupStatus = 0;
  let containersStarted = false;

  try {
    inspectRuntimeImages();
    const snapshotId = provisionSnapshot(dataRoot);
    process.stdout.write(`Provisioned offline fixture snapshot ${snapshotId}.\n`);

    const up = docker([...composeArguments, 'up', '--detach', '--no-build', '--wait'], environment);
    if (up.status !== 0) {
      process.stderr.write(`${up.stdout}${up.stderr}`);
      reportComposeDiagnosticsWithoutThrowing(environment);
      startupStatus = up.status ?? 1;
    } else {
      containersStarted = true;
      await verifyRuntime(snapshotId);
      verifyUpdaterOffline(environment);
      process.stdout.write(
        'Offline smoke test passed: gateway, Web map, API, ranged archive reads, local style, glyphs and sprites, and an offline updater.\n',
      );
    }
  } catch (error) {
    if (containersStarted) reportComposeDiagnosticsWithoutThrowing(environment);
    throw error;
  } finally {
    const down = docker(
      [...composeArguments, 'down', '--volumes', '--remove-orphans'],
      environment,
    );
    if (down.status !== 0) process.stderr.write(`${down.stdout}${down.stderr}`);
    await rm(dataRoot, { force: true, recursive: true });
  }
  return startupStatus;
}

process.exitCode = await main();
