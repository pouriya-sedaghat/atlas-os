import type {
  AtlasOs,
  BasemapResourceReader,
  DatasetManager,
  GeographicBounds,
} from './contracts.js';
import { ExternalTileBuilder } from './internal/builders/external.js';
import { SyntheticTileBuilder } from './internal/builders/synthetic.js';
import type { BasemapTileBuilder } from './internal/builders/types.js';
import { LocalBasemapResourceReader } from './internal/basemap/reader.js';
import { REQUIRED_SOURCE_LAYERS } from './internal/basemap/style.js';
import { EngineHostClient } from './internal/search/client.js';
import { readSearchEngines } from './internal/search/config.js';
import { SearchPipeline } from './internal/search/pipeline.js';
import { createSearchToolRunner } from './internal/search/runner.js';
import { readSearchToolConfig } from './internal/search/tools.js';
import { SearchService } from './internal/search/service.js';
import { SnapshotStore } from './internal/snapshot/store.js';
import { readToolConfig } from './internal/tools/config.js';
import { LocalAtlasOs, LocalDatasetManager } from './platform.js';
import { BasemapProvisioner } from './provisioning.js';

/**
 * Neutral provisioning intent.
 *
 * This is domain configuration — where the region is, which languages its labels use, which font
 * its glyphs come from. It says nothing about which tool builds the tiles or how that tool runs;
 * the platform decides that from its own configuration.
 */
export interface ProvisioningOptions {
  readonly bounds: GeographicBounds;
  /** Path to the font the glyph ranges are generated from. */
  readonly fontPath: string;
  readonly labelLanguages: readonly string[];
}

export interface PlatformOptions {
  readonly dataRoot: string;
  /**
   * Environment the platform reads its own provider configuration from. Defaults to the process
   * environment. Callers pass it through without interpreting it.
   */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly offline: boolean;
  /**
   * Present only in a process that is allowed to build datasets. A request-serving process
   * composes the platform without it, so dataset mutation is not merely unrouted there — it is
   * not wired up at all.
   */
  readonly provisioning?: ProvisioningOptions | undefined;
  readonly region: string;
}

export interface Platform {
  readonly atlas: AtlasOs;
  readonly datasets: DatasetManager;
  readonly resources: BasemapResourceReader;
}

/**
 * The search half of a preparation, or `undefined` for basemap-only snapshots. Read only in a
 * process that provisions, so a serving process never needs, or validates, tooling settings.
 */
function createSearchPipeline(
  environment: Readonly<Record<string, string | undefined>>,
): SearchPipeline | undefined {
  const tiles = readToolConfig(environment);
  const config = readSearchToolConfig(environment, tiles.kind);
  if (config.kind === 'none') return undefined;
  return new SearchPipeline({ kind: config.kind, runner: createSearchToolRunner(config) });
}

function createBuilder(
  environment: Readonly<Record<string, string | undefined>>,
): BasemapTileBuilder {
  const tool = readToolConfig(environment);
  if (tool.kind === 'synthetic') return new SyntheticTileBuilder();
  return new ExternalTileBuilder({
    jarPath: tool.jarPath,
    // The inputs a preparation demands are derived from the layers the basemap style draws.
    layers: [...REQUIRED_SOURCE_LAYERS],
    mode: tool.mode,
  });
}

/**
 * Composes the platform. Provider selection happens here and nowhere else, so neither the core
 * layer nor any application names a tile tool, a tile schema or a rendering SDK.
 */
export function createPlatform(options: PlatformOptions): Platform {
  const store = new SnapshotStore(options.dataRoot);
  const environment = options.environment ?? process.env;
  const provisioning = options.provisioning;
  const provisioner =
    provisioning === undefined
      ? undefined
      : new BasemapProvisioner({
          bounds: provisioning.bounds,
          builder: createBuilder(environment),
          fontPath: provisioning.fontPath,
          labelLanguages: provisioning.labelLanguages,
          region: options.region,
          search: createSearchPipeline(environment),
          store,
        });

  const search = new SearchService({
    client: new EngineHostClient(),
    engines: readSearchEngines(environment),
    region: options.region,
    store,
  });

  return {
    atlas: new LocalAtlasOs({ region: options.region, search, store }),
    datasets: new LocalDatasetManager({ offline: options.offline, provisioner, store }),
    resources: new LocalBasemapResourceReader(store),
  };
}
