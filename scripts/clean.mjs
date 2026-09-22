import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const targets = [
  'apps/api/dist',
  'apps/cli/dist',
  'apps/updater/dist',
  'apps/web/dist',
  'packages/atlas-os/dist',
  'packages/core/dist',
  'coverage',
];

for (const target of targets) {
  const absolute = resolve(root, target);
  if (!absolute.startsWith(`${root}\\`) && !absolute.startsWith(`${root}/`)) {
    throw new Error(`Refusing to clean path outside repository: ${absolute}`);
  }
  await rm(absolute, { force: true, recursive: true });
}
