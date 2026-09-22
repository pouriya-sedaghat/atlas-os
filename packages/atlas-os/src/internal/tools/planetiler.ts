import { basename, dirname } from 'node:path';

import { PlatformError } from '../../errors.js';
import type { BuildBounds } from '../builders/types.js';

/**
 * Pinned external tile-generation tool.
 *
 * This module is private to `packages/atlas-os`. Nothing outside the platform package knows the
 * tool's name, its source names, its flags, its image or its execution mode — callers see only
 * provider-neutral dataset-administration contracts.
 *
 * Every constant below was read from the pinned artifacts rather than assumed:
 * the tool at `com.onthegomap.planetiler:planetiler-core:0.10.2` on Maven Central, and the
 * OpenMapTiles profile at submodule commit `91516fdf477915b1a985015811049b9b96c7f87e`, which is
 * the commit the tool's own v0.10.2 tag pins.
 */
export const TOOL_NAME = 'planetiler';
export const TOOL_VERSION = '0.10.2';
export const TOOL_IMAGE =
  'ghcr.io/onthegomap/planetiler:0.10.2@sha256:cf32202dbc001a9ab4bc11534b642b13de3798179817da8558e567a3d13dd403';

/** Profile identity, from the generated schema class in the pinned profile commit. */
export const TOOL_SCHEMA = { name: 'OpenMapTiles', version: '3.16.0' } as const;

/**
 * Attribution the profile itself declares, reproduced verbatim.
 *
 * The OpenMapTiles-derived schema requires visible credit for both OpenMapTiles and OpenStreetMap
 * contributors. These are navigational hyperlinks shown in the attribution control; nothing
 * fetches them.
 */
export const TOOL_ATTRIBUTION =
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';

/**
 * Ancillary inputs the profile registers in addition to the OpenStreetMap extract.
 *
 * The identifiers are the profile's own source names; the tool derives the command-line flag for
 * each as `<name>_path`, and normalises `.`, `-` and `_` in argument keys equivalently.
 */
export const TOOL_SOURCE_IDS = {
  lakeCenterlines: 'lake_centerlines',
  naturalEarth: 'natural_earth',
  osm: 'osm',
  waterPolygons: 'water_polygons',
} as const;

export type ToolSourceId = (typeof TOOL_SOURCE_IDS)[keyof typeof TOOL_SOURCE_IDS];

/** Conventional file name for each input, used only in operator-facing guidance. */
export const TOOL_SOURCE_FILENAMES: Readonly<Record<ToolSourceId, string>> = {
  lake_centerlines: 'lake_centerline.shp.zip',
  natural_earth: 'natural_earth_vector.sqlite.zip',
  osm: '<region>.osm.pbf',
  water_polygons: 'water-polygons-split-3857.zip',
};

/**
 * Which ancillary inputs each schema layer actually consumes.
 *
 * Read from the profile's layer classes: a layer that implements the profile's Natural Earth,
 * water-polygon or lake-centerline processor interface consumes that source. Every layer also
 * consumes the OpenStreetMap extract.
 */
export const LAYER_SOURCE_REQUIREMENTS: Readonly<Record<string, readonly ToolSourceId[]>> = {
  aerodrome_label: [],
  aeroway: [],
  boundary: ['natural_earth'],
  building: [],
  housenumber: [],
  landcover: ['natural_earth'],
  landuse: ['natural_earth'],
  mountain_peak: ['natural_earth'],
  park: [],
  place: ['natural_earth'],
  poi: [],
  transportation: ['natural_earth'],
  transportation_name: [],
  water: ['natural_earth', 'water_polygons'],
  water_name: ['lake_centerlines', 'natural_earth'],
  waterway: ['natural_earth'],
};

/**
 * Inputs an operator must supply for a given set of schema layers.
 *
 * Derived from the layer requirements rather than hard-coded, so adding a layer to the basemap
 * style automatically widens the set of inputs the preparation demands instead of silently
 * producing a basemap missing that layer's data.
 */
export function requiredSourceIds(layers: readonly string[]): readonly ToolSourceId[] {
  const required = new Set<ToolSourceId>([TOOL_SOURCE_IDS.osm]);
  for (const layer of layers) {
    const requirements = LAYER_SOURCE_REQUIREMENTS[layer];
    if (requirements === undefined) {
      throw new PlatformError('INVALID_REQUEST', 'Unknown basemap schema layer requested.', {
        details: { layer },
      });
    }
    for (const source of requirements) required.add(source);
  }
  return [...required].sort();
}

export type ToolRunMode = 'container' | 'jar';

export interface ToolInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

export interface ToolInvocationOptions {
  readonly archivePath: string;
  readonly bounds: BuildBounds;
  readonly jarPath?: string | undefined;
  readonly languages: readonly string[];
  readonly layers: readonly string[];
  readonly maxZoom: number;
  readonly minZoom: number;
  readonly mode: ToolRunMode;
  /** Absolute host path for every required input, keyed by the tool's source name. */
  readonly sourcePaths: Readonly<Partial<Record<ToolSourceId, string>>>;
  readonly workDirectory: string;
}

function requireSourcePath(options: ToolInvocationOptions, id: ToolSourceId): string {
  const path = options.sourcePaths[id];
  if (path === undefined || path.length === 0) {
    throw new PlatformError('INVALID_REQUEST', 'A required basemap input is missing.', {
      details: { expectedFile: TOOL_SOURCE_FILENAMES[id], input: id },
    });
  }
  return path;
}

/** Container path each input is mounted at, keyed by the tool's source name. */
export const CONTAINER_SOURCE_PATHS: Readonly<Record<ToolSourceId, string>> = {
  lake_centerlines: '/data/sources/lake_centerline.shp.zip',
  natural_earth: '/data/sources/natural_earth_vector.sqlite.zip',
  osm: '/data/sources/region.osm.pbf',
  water_polygons: '/data/sources/water-polygons-split-3857.zip',
};

function commonArguments(
  options: ToolInvocationOptions,
  resolved: {
    readonly sources: Readonly<Record<string, string>>;
    readonly output: string;
    readonly work: string;
  },
): readonly string[] {
  const required = requiredSourceIds(options.layers);
  return [
    ...required.flatMap((id) => [`--${id}_path`, resolved.sources[id]!]),
    '--output',
    resolved.output,
    '--tmpdir',
    resolved.work,
    '--force',
    // Keep the run entirely local. `download` already defaults to false, and `use_wikidata`
    // defaults to TRUE, so disabling it is required rather than decorative: otherwise the tool
    // reads a Wikidata translation cache this deployment never produces.
    '--download=false',
    '--fetch_wikidata=false',
    '--use_wikidata=false',
    '--only_layers=' + [...options.layers].join(','),
    `--bounds=${options.bounds.west},${options.bounds.south},${options.bounds.east},${options.bounds.north}`,
    `--minzoom=${options.minZoom}`,
    `--maxzoom=${options.maxZoom}`,
    `--languages=${options.languages.join(',')}`,
  ];
}

/**
 * Builds the exact command line used to generate an archive.
 *
 * Pure, and therefore directly testable: the provisioning tests assert the argument list and the
 * container mounts without running the tool, so the contract with the external tool is covered
 * even where the tool itself cannot be executed.
 */
export function toolInvocation(options: ToolInvocationOptions): ToolInvocation {
  const required = requiredSourceIds(options.layers);

  if (options.mode === 'jar') {
    const sources = Object.fromEntries(required.map((id) => [id, requireSourcePath(options, id)]));
    return {
      args: [
        '-Xmx4g',
        '-jar',
        requireJarPath(options),
        ...commonArguments(options, {
          output: options.archivePath,
          sources,
          work: options.workDirectory,
        }),
      ],
      command: 'java',
    };
  }

  // Container mode mounts every input read-only at a fixed path, mounts only the working and
  // output directories writable, disables networking outright, and runs as the invoking user so
  // generated files are not owned by root.
  const mounts = required.flatMap((id) => [
    '--volume',
    `${requireSourcePath(options, id)}:${CONTAINER_SOURCE_PATHS[id]}:ro`,
  ]);
  const sources = Object.fromEntries(required.map((id) => [id, CONTAINER_SOURCE_PATHS[id]]));

  return {
    args: [
      'run',
      '--rm',
      '--network=none',
      '--user',
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      ...mounts,
      '--volume',
      `${options.workDirectory}:/data/work`,
      '--volume',
      `${dirname(options.archivePath)}:/data/out`,
      TOOL_IMAGE,
      ...commonArguments(options, {
        output: `/data/out/${basename(options.archivePath)}`,
        sources,
        work: '/data/work',
      }),
    ],
    command: 'docker',
  };
}

function requireJarPath(options: ToolInvocationOptions): string {
  if (options.jarPath === undefined || options.jarPath.length === 0) {
    throw new PlatformError('INVALID_REQUEST', 'A tool archive path is required in jar mode.', {
      details: { mode: options.mode },
    });
  }
  return options.jarPath;
}
