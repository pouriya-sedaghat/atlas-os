import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const applicationAudit = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const app = '/app';
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
for (const localName of ['core', 'platform']) {
  const localRoot = path.join(app, 'node_modules', '@atlas-os', localName);
  if (!fs.existsSync(localRoot)) continue;
  const localEntries = fs.readdirSync(localRoot).sort();
  if (JSON.stringify(localEntries) !== JSON.stringify(['dist', 'package.json'])) {
    throw new Error('unexpected files in @atlas-os/' + localName + ': ' + localEntries.join(','));
  }
  const localManifest = JSON.parse(fs.readFileSync(path.join(localRoot, 'package.json'), 'utf8'));
  if (localManifest.devDependencies) throw new Error(localName + ' devDependencies leaked');
}
const pnpmRoot = path.join(app, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmRoot)) {
  const forbidden = /^(?:@eslint\+|@types\+|@vitejs\+|esbuild@|eslint@|prettier@|rollup@|tsx@|typescript@|typescript-eslint@|vite@|vitest@)/;
  const leaked = fs.readdirSync(pnpmRoot).filter((entry) => forbidden.test(entry));
  if (leaked.length > 0) throw new Error('development dependencies leaked: ' + leaked.join(','));
}
for (const forbidden of ['.env', '.env.local', '.validation', 'docs', 'src', 'tests']) {
  if (fs.existsSync(path.join(app, forbidden))) throw new Error('forbidden app payload: ' + forbidden);
}
process.stdout.write(JSON.stringify({application: manifest.name, rootEntries}) + '\n');
`;

function docker(arguments_) {
  return spawnSync('docker', arguments_, { encoding: 'utf8', stdio: 'pipe' });
}

export function inspectRuntimeImages() {
  const images = ['atlas-os/api:m0', 'atlas-os/updater:m0'];
  for (const image of images) {
    const result = docker(['run', '--rm', '--entrypoint', 'node', image, '-e', applicationAudit]);
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
