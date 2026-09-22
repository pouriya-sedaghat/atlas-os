import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Platform, SnapshotId } from '@atlas-os/platform';
import { createPlatform } from '@atlas-os/platform';

export const REGION = 'iran';
export const REGION_BOUNDS = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 } as const;
export const LABEL_LANGUAGES = ['fa', 'en'] as const;
export const FONT_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  'assets',
  'fonts',
  'Vazirmatn-Regular.ttf',
);

export interface TestPlatform {
  readonly dataRoot: string;
  readonly platform: Platform;
  cleanup(): Promise<void>;
}

/** Composes a provisioning-capable platform backed by a throwaway data root. */
export async function createTestPlatform(
  options: {
    readonly builder?: 'external' | 'synthetic';
    readonly dataRoot?: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly provisioning?: boolean;
    readonly region?: string;
  } = {},
): Promise<TestPlatform> {
  // A caller may share a data root to compose a second platform over the same storage, which is
  // how the region-mismatch and read-only serving cases are exercised.
  const owned = options.dataRoot === undefined;
  const dataRoot = options.dataRoot ?? (await mkdtemp(join(tmpdir(), 'atlas-os-test-')));
  const region = options.region ?? REGION;
  const platform = createPlatform({
    dataRoot,
    // Tooling selection is the platform's own configuration, read from the environment it is
    // given. It is never an argument an application could pass.
    environment: {
      ATLAS_TILE_TOOL_KIND: options.builder ?? 'synthetic',
      ...options.environment,
    },
    offline: true,
    ...(options.provisioning === false
      ? {}
      : {
          provisioning: {
            bounds: REGION_BOUNDS,
            fontPath: FONT_PATH,
            labelLanguages: [...LABEL_LANGUAGES],
          },
        }),
    region,
  });
  return {
    cleanup: async () => {
      if (owned) await rm(dataRoot, { force: true, recursive: true });
    },
    dataRoot,
    platform,
  };
}

/** Prepares and activates one snapshot, returning its identifier. */
export async function installSnapshot(
  platform: Platform,
  sourceName = 'synthetic-fixture',
): Promise<SnapshotId> {
  const id = await platform.datasets.prepareUpdate({ inputs: [], sourceName });
  await platform.datasets.activateSnapshot(id);
  return id;
}
