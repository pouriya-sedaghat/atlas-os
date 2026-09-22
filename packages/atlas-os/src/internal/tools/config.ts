import type { ToolRunMode } from './planetiler.js';

/**
 * Provider-specific provisioning configuration.
 *
 * This is read here, inside the platform package, and nowhere else. Neither the core layer nor
 * any application knows that a tile tool exists, which implementation is selected, or how it is
 * executed — they pass only neutral domain configuration and the raw environment.
 */
export interface ToolConfig {
  /** Which tile-generation implementation to use. */
  readonly kind: 'external' | 'synthetic';
  /** How the external tool is executed. */
  readonly mode: ToolRunMode;
  /** Path to a local tool archive, when it is executed directly rather than as a container. */
  readonly jarPath: string | undefined;
}

const TOOL_KIND_KEY = 'ATLAS_TILE_TOOL_KIND';
const TOOL_MODE_KEY = 'ATLAS_TILE_TOOL_MODE';
const TOOL_ARCHIVE_KEY = 'ATLAS_TILE_TOOL_ARCHIVE';

/**
 * Reads the tool configuration from an environment.
 *
 * Defaults to the production path. A deployment that has not configured anything gets the
 * external tool in container mode, never the generated development fixture.
 */
export function readToolConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ToolConfig {
  const archive = environment[TOOL_ARCHIVE_KEY];
  return {
    jarPath: archive === undefined || archive.length === 0 ? undefined : archive,
    kind: environment[TOOL_KIND_KEY] === 'synthetic' ? 'synthetic' : 'external',
    mode: environment[TOOL_MODE_KEY] === 'jar' ? 'jar' : 'container',
  };
}
