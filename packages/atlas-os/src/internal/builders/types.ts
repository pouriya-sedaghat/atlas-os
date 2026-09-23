import type { DatasetInput, DatasetInputProvenance } from '../../contracts.js';

export interface BuildBounds {
  readonly east: number;
  readonly north: number;
  readonly south: number;
  readonly west: number;
}

export interface BasemapBuildRequest {
  /** Absolute path the builder must write the archive to. */
  readonly archivePath: string;
  readonly bounds: BuildBounds;
  /** Operator-supplied inputs, as given. */
  readonly inputs: readonly DatasetInput[];
  readonly labelLanguages: readonly string[];
  readonly region: string;
  /** Human-readable name of the preparation, recorded in the snapshot manifest. */
  readonly sourceName: string;
}

export interface BasemapBuildResult {
  readonly attribution: string;
  readonly bounds: BuildBounds;
  readonly center: { readonly latitude: number; readonly longitude: number; readonly zoom: number };
  /** Provenance for every input the build actually consumed. */
  readonly inputs: readonly DatasetInputProvenance[];
  readonly maxZoom: number;
  readonly minZoom: number;
  readonly schema: { readonly name: string; readonly version: string };
  readonly sourceLayers: readonly string[];
  readonly tool: { readonly name: string; readonly version: string };
}

/**
 * Produces the vector tile archive for a snapshot.
 *
 * Implementations are private to this package. Everything downstream — validation, checksums,
 * manifest, activation and serving — is identical whichever implementation ran, so the test
 * builder exercises the same pipeline the production builder feeds.
 */
export interface BasemapTileBuilder {
  readonly id: string;
  build(request: BasemapBuildRequest): Promise<BasemapBuildResult>;
}
