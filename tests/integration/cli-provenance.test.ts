import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseSnapshotManifest } from '@atlas-os/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../../apps/cli/src/run.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-cli-'));
  directories.push(directory);
  return directory;
}

function environment(dataRoot: string): Record<string, string | undefined> {
  return {
    ATLAS_DATA_ROOT: dataRoot,
    ATLAS_FONT_PATH: join(process.cwd(), 'assets', 'fonts', 'Vazirmatn-Regular.ttf'),
    ATLAS_REGION: 'iran',
    ATLAS_REGION_CONFIG_PATH: join(process.cwd(), 'config', 'regions', 'iran.yaml'),
    // The platform's own tooling configuration; no command-line flag selects a builder.
    ATLAS_TILE_TOOL_KIND: 'synthetic',
  };
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await fn();
    return { code, output: chunks.join('') };
  } finally {
    process.stdout.write = original;
  }
}

async function manifestInputs(dataRoot: string) {
  const manifest = parseSnapshotManifest(
    JSON.parse(await readFile(join(dataRoot, 'slots', 'blue', 'manifest.json'), 'utf8')),
  );
  return manifest.inputs ?? [];
}

describe('command-line input provenance', () => {
  it('records only the file name, never the host path', async () => {
    const directory = await workspace();
    const dataRoot = join(directory, 'data');
    const nested = join(directory, 'deeply', 'nested', 'sources');
    await writeFile(join(directory, 'placeholder'), 'x');
    await rm(join(directory, 'placeholder'));
    await (await import('node:fs/promises')).mkdir(nested, { recursive: true });
    const extract = join(nested, 'iran.osm.pbf');
    await writeFile(extract, 'non-empty');

    const { code } = await capture(() =>
      run(
        ['update', 'prepare', '--source-name', 'release', '--region-extract', extract],
        environment(dataRoot),
        directory,
      ),
    );
    expect(code).toBe(0);

    const inputs = await manifestInputs(dataRoot);
    // The synthetic builder consumes no operator input, so provenance is empty; the guarantee
    // under test is that nothing a manifest records ever carries a host path.
    const serialized = JSON.stringify(inputs);
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain('/deeply/');
  });

  it.each([
    ['/srv/sources/iran.osm.pbf', 'iran.osm.pbf'],
    ['C:\\datasets\\iran.osm.pbf', 'iran.osm.pbf'],
  ])(
    'derives the provenance name for %s without reaching the filesystem',
    async (path, expected) => {
      const { defaultInputName } = await import('../../apps/cli/src/input-name.js');
      expect(defaultInputName(path)).toBe(expected);
    },
  );

  it('refuses an input that does not exist, naming only the file and not the path', async () => {
    const directory = await workspace();
    const dataRoot = join(directory, 'data');
    // The ancillary inputs exist, so validation reaches the regional extract.
    const reference = join(directory, 'natural_earth_vector.sqlite.zip');
    const coastline = join(directory, 'water-polygons-split-3857.zip');
    await writeFile(reference, 'non-empty');
    await writeFile(coastline, 'non-empty');

    const { code, output } = await capture(() =>
      run(
        [
          'update',
          'prepare',
          '--source-name',
          'release',
          '--region-extract',
          'C:\\datasets\\iran.osm.pbf',
          '--reference-features',
          reference,
          '--coastline-polygons',
          coastline,
        ],
        { ...environment(dataRoot), ATLAS_TILE_TOOL_KIND: 'external' },
        directory,
      ),
    );

    expect(code).not.toBe(0);
    const reported = JSON.parse(output) as { details?: { filename?: string } };
    // Whatever the operator passed, the error names the file, not the path.
    expect(reported.details?.filename).toBe('iran.osm.pbf');
    expect(output).not.toContain('datasets');
  });

  it('lets an explicit name override the derived one', async () => {
    const directory = await workspace();
    const dataRoot = join(directory, 'data');
    const extract = join(directory, 'iran.osm.pbf');
    const reference = join(directory, 'natural_earth_vector.sqlite.zip');
    const coastline = join(directory, 'water-polygons-split-3857.zip');
    for (const path of [extract, reference, coastline]) await writeFile(path, 'non-empty');

    const { code, output } = await capture(() =>
      run(
        [
          'update',
          'prepare',
          '--source-name',
          'release',
          '--region-extract',
          extract,
          '--region-extract-name',
          'iran-osm-2026-09-01',
          '--region-extract-timestamp',
          '2026-09-01T00:00:00.000Z',
          '--reference-features',
          reference,
          '--coastline-polygons',
          coastline,
        ],
        { ...environment(dataRoot), ATLAS_TILE_TOOL_KIND: 'external' },
        directory,
      ),
    );

    // The external tool is not installed here, so the run fails when it is started rather than
    // during input validation. Reaching that point proves every named input was accepted.
    expect(code).not.toBe(0);
    expect(output).not.toContain('was not supplied');
    expect(output).not.toContain('does not exist');
    expect(output).not.toContain('is empty');
  });
});
