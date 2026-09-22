import { open, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function fsyncDirectory(path: string): Promise<void> {
  // Renaming is only durable once the containing directory entry is flushed. Some platforms
  // refuse to open a directory for fsync; a failure here must not fail the activation.
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch {
    return;
  } finally {
    await handle?.close();
  }
}

/**
 * Writes `data` to a sibling temporary file, flushes it, then renames it over `path`.
 * `rename` within one filesystem is atomic, so a reader sees either the previous file or the
 * complete new one — never a truncated pointer.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${Date.now()}-${process.pid}.tmp`);
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await fsyncDirectory(directory);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
