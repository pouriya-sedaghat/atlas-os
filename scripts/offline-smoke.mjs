import { spawnSync } from 'node:child_process';

import { inspectRuntimeImages } from './inspect-runtime-images.mjs';

const composeFile = 'infra/compose/compose.yaml';
const project = 'atlas-os-m0-offline';

function docker(arguments_) {
  return spawnSync('docker', arguments_, { encoding: 'utf8', stdio: 'pipe' });
}

const version = docker(['compose', 'version']);
if (version.error || version.status !== 0) {
  process.stderr.write(
    'Docker Compose is unavailable. Provision images with `pnpm compose:build`, then run `pnpm test:offline` on a Docker host.\n',
  );
  process.exit(2);
}

const composeArguments = ['compose', '-f', composeFile, '-p', project];

function writeCommandDiagnostics(label, result) {
  process.stderr.write(`\n${label}\n`);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function reportStartupFailure() {
  writeCommandDiagnostics('docker compose ps --all', docker([...composeArguments, 'ps', '--all']));
  for (const service of ['web', 'gateway', 'api', 'updater']) {
    writeCommandDiagnostics(
      `docker compose logs --no-color ${service}`,
      docker([...composeArguments, 'logs', '--no-color', service]),
    );
  }
}

async function requireOk(path) {
  const response = await fetch(`http://127.0.0.1:8080${path}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  let startupStatus = 0;
  try {
    inspectRuntimeImages();
    const up = docker([...composeArguments, 'up', '--detach', '--no-build', '--wait']);
    if (up.status !== 0) {
      process.stderr.write(`${up.stdout}${up.stderr}`);
      reportStartupFailure();
      startupStatus = up.status ?? 1;
    } else {
      const [web, health, dataset] = await Promise.all([
        requireOk('/'),
        requireOk('/api/health'),
        requireOk('/api/v1/dataset'),
      ]);
      if (!web.includes('atlas-os')) throw new Error('Web application marker was not found.');
      if (!health.includes('"status":"ok"')) throw new Error('API health payload was unexpected.');
      if (!dataset.includes('"state":"not_installed"')) {
        throw new Error('Dataset payload was unexpected.');
      }
      const updater = docker([
        ...composeArguments,
        'exec',
        '--no-TTY',
        'updater',
        'node',
        '-e',
        "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(j=>{if(j.status!=='ok'||j.updateConnectivity!=='offline')process.exit(1)}).catch(()=>process.exit(1))",
      ]);
      if (updater.status !== 0) {
        throw new Error(`Updater offline health check failed: ${updater.stdout}${updater.stderr}`);
      }
      process.stdout.write('Offline smoke test passed on the internal-only runtime network.\n');
    }
  } finally {
    const down = docker([...composeArguments, 'down', '--volumes', '--remove-orphans']);
    if (down.status !== 0) process.stderr.write(`${down.stdout}${down.stderr}`);
  }
  return startupStatus;
}

process.exitCode = await main();
