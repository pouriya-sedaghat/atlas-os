import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REQUIRED_SOURCE_LAYERS } from '../../packages/atlas-os/src/internal/basemap/style.js';
import { resolveInputs } from '../../packages/atlas-os/src/internal/builders/external.js';
import {
  CONTAINER_SOURCE_PATHS,
  LAYER_SOURCE_REQUIREMENTS,
  TOOL_ATTRIBUTION,
  TOOL_IMAGE,
  TOOL_SCHEMA,
  TOOL_SOURCE_IDS,
  TOOL_VERSION,
  requiredSourceIds,
  toolInvocation,
} from '../../packages/atlas-os/src/internal/tools/planetiler.js';

const BOUNDS = { east: 63.333, north: 39.782, south: 24.397, west: 44.033 } as const;

/**
 * The external tile tool is provisioning-only and cannot be executed in this environment, so its
 * contract is covered by asserting the exact command line, mounts and pre-flight input checks.
 * These assertions are not a substitute for an executed production build.
 */
describe('required inputs', () => {
  it('derives the required inputs from the layers the basemap style draws', () => {
    const required = requiredSourceIds([...REQUIRED_SOURCE_LAYERS]);

    // The profile's own layer classes determine this: water needs both the reference geometry
    // and the coastline polygons, boundary/place/transportation need the reference geometry,
    // building needs neither.
    expect(required).toEqual(['natural_earth', 'osm', 'water_polygons']);
  });

  it('demands the lake centreline input only when a layer that uses it is drawn', () => {
    expect(requiredSourceIds(['water_name'])).toContain(TOOL_SOURCE_IDS.lakeCenterlines);
    expect(requiredSourceIds([...REQUIRED_SOURCE_LAYERS])).not.toContain(
      TOOL_SOURCE_IDS.lakeCenterlines,
    );
  });

  it('always demands the regional extract', () => {
    expect(requiredSourceIds([])).toEqual([TOOL_SOURCE_IDS.osm]);
    expect(requiredSourceIds(['building'])).toEqual([TOOL_SOURCE_IDS.osm]);
  });

  it('refuses a layer the profile does not define', () => {
    expect(() => requiredSourceIds(['not_a_layer'])).toThrow(/Unknown basemap schema layer/);
  });

  it('knows the source requirements of every layer the profile defines', () => {
    for (const layer of REQUIRED_SOURCE_LAYERS) {
      expect(LAYER_SOURCE_REQUIREMENTS, `layer ${layer}`).toHaveProperty(layer);
    }
  });
});

describe('input validation before the tool runs', () => {
  let directory: string;
  let extract: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-inputs-'));
    extract = join(directory, 'region.osm.pbf');
    await writeFile(extract, 'not really a pbf but non-empty');
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('records provenance and a checksum for every input it resolves', async () => {
    const resolved = await resolveInputs(
      [
        {
          kind: 'region_extract',
          name: 'iran-osm-2026-09-01',
          path: extract,
          timestamp: '2026-09-01T00:00:00.000Z',
        },
      ],
      [TOOL_SOURCE_IDS.osm],
    );

    expect(resolved).toHaveLength(1);
    const provenance = resolved[0]!.provenance;
    expect(provenance).toMatchObject({
      bytes: 30,
      filename: 'region.osm.pbf',
      kind: 'region_extract',
      name: 'iran-osm-2026-09-01',
      timestamp: '2026-09-01T00:00:00.000Z',
    });
    expect(provenance.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Provenance travels with the snapshot, so it must not disclose the build host's layout.
    expect(JSON.stringify(provenance)).not.toContain(directory);
  });

  it('refuses a preparation that omits a required input, naming what is missing', async () => {
    await expect(
      resolveInputs(
        [{ kind: 'region_extract', name: 'extract', path: extract }],
        [TOOL_SOURCE_IDS.osm, TOOL_SOURCE_IDS.naturalEarth],
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      details: {
        expectedFile: 'natural_earth_vector.sqlite.zip',
        requiredInput: 'reference_features',
      },
    });
  });

  it.each([
    ['absent', 'missing.zip', /does not exist/],
    ['a directory', '.', /is not a file/],
    ['empty', 'empty.zip', /is empty/],
  ])('refuses an input that is %s', async (_case, name, message) => {
    if (name === 'empty.zip') await writeFile(join(directory, name), '');
    await expect(
      resolveInputs(
        [{ kind: 'region_extract', name: 'extract', path: join(directory, name) }],
        [TOOL_SOURCE_IDS.osm],
      ),
    ).rejects.toThrow(message);
  });

  it('refuses a duplicate input for the same role', async () => {
    await expect(
      resolveInputs(
        [
          { kind: 'region_extract', name: 'a', path: extract },
          { kind: 'region_extract', name: 'b', path: extract },
        ],
        [TOOL_SOURCE_IDS.osm],
      ),
    ).rejects.toThrow(/Duplicate basemap input/);
  });

  it('refuses an input that cannot be read', async () => {
    const dangling = join(directory, 'dangling.zip');
    await symlink(join(directory, 'nowhere.zip'), dangling);
    await expect(
      resolveInputs(
        [{ kind: 'region_extract', name: 'dangling', path: dangling }],
        [TOOL_SOURCE_IDS.osm],
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('external tile tool invocation', () => {
  const layers = [...REQUIRED_SOURCE_LAYERS];
  const sourcePaths = {
    natural_earth: '/srv/sources/natural_earth_vector.sqlite.zip',
    osm: '/srv/sources/iran.osm.pbf',
    water_polygons: '/srv/sources/water-polygons-split-3857.zip',
  };
  const base = {
    archivePath: '/data/slots/green/basemap/basemap.pmtiles',
    bounds: BOUNDS,
    languages: ['fa', 'en'],
    layers,
    maxZoom: 14,
    minZoom: 0,
    sourcePaths,
    workDirectory: '/data/tmp/tool-work',
  } as const;

  it('pins the tool image by immutable digest', () => {
    expect(TOOL_IMAGE).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(TOOL_IMAGE).toContain(`:${TOOL_VERSION}@`);
    expect(TOOL_IMAGE).not.toContain(':latest');
  });

  it('records the schema identity the pinned profile declares', () => {
    expect(TOOL_SCHEMA).toEqual({ name: 'OpenMapTiles', version: '3.16.0' });
  });

  it('passes every required input, and no input that is not required', () => {
    const args = toolInvocation({ ...base, mode: 'container' }).args;

    expect(args).toContain('--osm_path');
    expect(args).toContain('--natural_earth_path');
    expect(args).toContain('--water_polygons_path');
    // Not required by the layers this basemap draws, so it is not demanded or passed.
    expect(args.join(' ')).not.toContain('--lake_centerlines_path');
  });

  it('mounts every input read-only and disables networking', () => {
    const args = toolInvocation({ ...base, mode: 'container' }).args;
    const joined = args.join(' ');

    expect(args[0]).toBe('run');
    expect(joined).toContain('--network=none');
    expect(joined).toContain('--rm');
    for (const [id, hostPath] of Object.entries(sourcePaths)) {
      const containerPath = CONTAINER_SOURCE_PATHS[id as keyof typeof CONTAINER_SOURCE_PATHS];
      expect(joined, `mount for ${id}`).toContain(`${hostPath}:${containerPath}:ro`);
    }
    // Only the working and output directories are writable.
    expect(joined).toContain('/data/tmp/tool-work:/data/work');
    expect(joined).toContain('/data/slots/green/basemap:/data/out');
    expect(joined).not.toContain('--privileged');
    expect(joined).not.toContain('/var/run/docker.sock');
  });

  it('never allows the tool to download or reach the network', () => {
    const joined = toolInvocation({ ...base, mode: 'container' }).args.join(' ');

    expect(joined).toContain('--download=false');
    expect(joined).toContain('--fetch_wikidata=false');
    // The tool's own default for this is true, so disabling it is required, not decorative.
    expect(joined).toContain('--use_wikidata=false');
    expect(joined).not.toMatch(/--\w+_url=/);
    expect(joined).not.toContain('geofabrik');
    expect(joined).not.toContain('--area');
  });

  it('passes the region bounds, zoom range, layers and label languages', () => {
    const joined = toolInvocation({ ...base, mode: 'container' }).args.join(' ');

    expect(joined).toContain('--bounds=44.033,24.397,63.333,39.782');
    expect(joined).toContain('--minzoom=0');
    expect(joined).toContain('--maxzoom=14');
    expect(joined).toContain('--languages=fa,en');
    expect(joined).toContain(`--only_layers=${layers.join(',')}`);
  });

  it('builds equivalent container and local-runtime commands', () => {
    const container = toolInvocation({ ...base, mode: 'container' });
    const jar = toolInvocation({ ...base, jarPath: '/opt/tools/tiler.jar', mode: 'jar' });

    expect(container.command).toBe('docker');
    expect(jar.command).toBe('java');
    expect(jar.args).toContain('-jar');
    expect(jar.args).toContain('/opt/tools/tiler.jar');

    // The tool-facing arguments must be identical apart from the paths, which differ only
    // because container mode sees the inputs at their mount points. Container arguments end at
    // the image reference; local-runtime arguments end at the archive path.
    const toolArgs = (args: readonly string[]): string[] => {
      const imageIndex = args.indexOf(TOOL_IMAGE);
      if (imageIndex !== -1) return args.slice(imageIndex + 1);
      return args.slice(args.indexOf('/opt/tools/tiler.jar') + 1);
    };
    const normalise = (args: readonly string[]): string[] =>
      toolArgs(args).map((arg) => {
        for (const [id, hostPath] of Object.entries(sourcePaths)) {
          const containerPath = CONTAINER_SOURCE_PATHS[id as keyof typeof CONTAINER_SOURCE_PATHS];
          if (arg === hostPath || arg === containerPath) return `<${id}>`;
        }
        if (arg === '/data/work' || arg === base.workDirectory) return '<work>';
        if (arg === base.archivePath || arg === '/data/out/basemap.pmtiles') return '<output>';
        return arg;
      });

    expect(normalise(jar.args)).toEqual(normalise(container.args));
  });

  it('refuses local runtime mode without an archive path', () => {
    expect(() => toolInvocation({ ...base, mode: 'jar' })).toThrow(/archive path is required/i);
  });

  it('refuses to build a command when a required input path is absent', () => {
    expect(() =>
      toolInvocation({ ...base, mode: 'container', sourcePaths: { osm: sourcePaths.osm } }),
    ).toThrow(/required basemap input is missing/i);
  });

  it('declares attribution for both projects the schema requires', () => {
    expect(TOOL_ATTRIBUTION).toContain('https://www.openmaptiles.org/');
    expect(TOOL_ATTRIBUTION).toContain('https://www.openstreetmap.org/copyright');
    expect(TOOL_ATTRIBUTION).toContain('OpenMapTiles');
    expect(TOOL_ATTRIBUTION).toContain('OpenStreetMap contributors');
  });
});
