import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DatasetInput, DatasetInputKind, DatasetInputProvenance } from '../../contracts.js';
import { PlatformError } from '../../errors.js';
import { sha256File } from '../fs/checksum.js';
import type { ToolRunMode, ToolSourceId } from '../tools/planetiler.js';
import {
  TOOL_ATTRIBUTION,
  TOOL_NAME,
  TOOL_SCHEMA,
  TOOL_SOURCE_FILENAMES,
  TOOL_SOURCE_IDS,
  TOOL_VERSION,
  requiredSourceIds,
  toolInvocation,
} from '../tools/planetiler.js';
import type { BasemapBuildRequest, BasemapBuildResult, BasemapTileBuilder } from './types.js';

export const EXTERNAL_BUILDER_ID = 'external';
export const EXTERNAL_MIN_ZOOM = 0;
export const EXTERNAL_MAX_ZOOM = 14;

/** Maps a neutral input role onto the private tool's own source name. */
const KIND_TO_SOURCE: Readonly<Record<DatasetInputKind, ToolSourceId>> = {
  coastline_polygons: TOOL_SOURCE_IDS.waterPolygons,
  lake_centerlines: TOOL_SOURCE_IDS.lakeCenterlines,
  reference_features: TOOL_SOURCE_IDS.naturalEarth,
  region_extract: TOOL_SOURCE_IDS.osm,
};

const SOURCE_TO_KIND: Readonly<Record<ToolSourceId, DatasetInputKind>> = {
  lake_centerlines: 'lake_centerlines',
  natural_earth: 'reference_features',
  osm: 'region_extract',
  water_polygons: 'coastline_polygons',
};

export interface ExternalBuilderOptions {
  readonly jarPath?: string | undefined;
  readonly layers: readonly string[];
  readonly maxZoom?: number;
  readonly minZoom?: number;
  readonly mode: ToolRunMode;
}

interface ResolvedInput {
  readonly input: DatasetInput;
  readonly provenance: DatasetInputProvenance;
  readonly source: ToolSourceId;
}

/**
 * Generates the basemap archive with the pinned external tile tool from operator-supplied inputs.
 *
 * The tool's profile registers ancillary inputs alongside the regional extract, and it does not
 * require them to exist when it starts: a missing one surfaces as a late failure or, where the
 * stage is skipped, as a quietly incomplete basemap. Every required input is therefore resolved,
 * checked and hashed here *before* the tool is started, and a missing or unreadable one refuses
 * the preparation with an actionable error.
 *
 * The tool is provisioning-only: it is never installed into, or invoked from, the request-serving
 * images. A run reads only the declared inputs and performs no network access of its own.
 */
export class ExternalTileBuilder implements BasemapTileBuilder {
  readonly id = EXTERNAL_BUILDER_ID;
  readonly #options: ExternalBuilderOptions;

  constructor(options: ExternalBuilderOptions) {
    this.#options = options;
  }

  async build(request: BasemapBuildRequest): Promise<BasemapBuildResult> {
    const required = requiredSourceIds(this.#options.layers);
    const resolved = await resolveInputs(request.inputs, required);

    const minZoom = this.#options.minZoom ?? EXTERNAL_MIN_ZOOM;
    const maxZoom = this.#options.maxZoom ?? EXTERNAL_MAX_ZOOM;
    const workDirectory = join(dirname(request.archivePath), 'tool-work');
    await mkdir(workDirectory, { recursive: true });

    const invocation = toolInvocation({
      archivePath: request.archivePath,
      bounds: request.bounds,
      jarPath: this.#options.jarPath,
      languages: request.labelLanguages,
      layers: this.#options.layers,
      maxZoom,
      minZoom,
      mode: this.#options.mode,
      sourcePaths: Object.fromEntries(resolved.map((entry) => [entry.source, entry.input.path])),
      workDirectory,
    });

    await runToCompletion(invocation.command, invocation.args);

    return {
      attribution: TOOL_ATTRIBUTION,
      bounds: request.bounds,
      center: {
        latitude: (request.bounds.north + request.bounds.south) / 2,
        longitude: (request.bounds.east + request.bounds.west) / 2,
        zoom: 5,
      },
      inputs: resolved.map((entry) => entry.provenance),
      maxZoom,
      minZoom,
      schema: { name: TOOL_SCHEMA.name, version: TOOL_SCHEMA.version },
      sourceLayers: [...this.#options.layers],
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
    };
  }
}

/**
 * Resolves, validates and hashes every required input.
 *
 * Fails before the tool is started, naming the missing role and the file it expects, so an
 * operator sees an actionable error rather than a deep stack trace from the tool or, worse, a
 * basemap that is quietly missing a layer's data.
 */
export async function resolveInputs(
  inputs: readonly DatasetInput[],
  required: readonly ToolSourceId[],
): Promise<readonly ResolvedInput[]> {
  const byKind = new Map<DatasetInputKind, DatasetInput>();
  for (const input of inputs) {
    if (byKind.has(input.kind)) {
      throw new PlatformError('INVALID_REQUEST', 'Duplicate basemap input supplied.', {
        details: { kind: input.kind },
      });
    }
    byKind.set(input.kind, input);
  }

  const resolved: ResolvedInput[] = [];
  for (const source of required) {
    const kind = SOURCE_TO_KIND[source];
    const input = byKind.get(kind);
    if (input === undefined) {
      throw new PlatformError('INVALID_REQUEST', 'A required basemap input was not supplied.', {
        details: {
          expectedFile: TOOL_SOURCE_FILENAMES[source],
          required: required.map((id) => SOURCE_TO_KIND[id]),
          requiredInput: kind,
        },
      });
    }

    const details = await stat(input.path).catch(() => undefined);
    if (details === undefined) {
      throw new PlatformError('INVALID_REQUEST', 'A required basemap input does not exist.', {
        details: { filename: basenameOf(input.path), requiredInput: kind },
      });
    }
    if (!details.isFile()) {
      throw new PlatformError('INVALID_REQUEST', 'A required basemap input is not a file.', {
        details: { filename: basenameOf(input.path), requiredInput: kind },
      });
    }
    if (details.size === 0) {
      throw new PlatformError('INVALID_REQUEST', 'A required basemap input is empty.', {
        details: { filename: basenameOf(input.path), requiredInput: kind },
      });
    }

    const checksum = await sha256File(input.path).catch(() => undefined);
    if (checksum === undefined) {
      throw new PlatformError('INVALID_REQUEST', 'A required basemap input is not readable.', {
        details: { filename: basenameOf(input.path), requiredInput: kind },
      });
    }

    resolved.push({
      input,
      provenance: {
        bytes: details.size,
        checksum,
        filename: basenameOf(input.path),
        kind,
        name: input.name,
        timestamp: input.timestamp ?? null,
      },
      source,
    });
  }
  return resolved;
}

function basenameOf(path: string): string {
  const normalised = path.replaceAll('\\', '/');
  return normalised.slice(normalised.lastIndexOf('/') + 1);
}

function runToCompletion(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (error) => {
      rejectPromise(
        new PlatformError('INTERNAL_ERROR', `Tile tool could not be started: ${command}.`, {
          cause: error,
          details: { command },
        }),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new PlatformError('INTERNAL_ERROR', 'Tile tool exited with a failure status.', {
          details: { command, exitCode: code },
        }),
      );
    });
  });
}

export { KIND_TO_SOURCE, SOURCE_TO_KIND };
