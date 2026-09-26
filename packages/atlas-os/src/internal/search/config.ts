import { PlatformError } from '../../errors.js';
import type { SlotName } from '../../snapshot.js';
import type { SearchEngines } from './service.js';

const ENGINE_URL_KEYS: Readonly<Record<SlotName, string>> = {
  blue: 'ATLAS_SEARCH_ENGINE_BLUE_URL',
  green: 'ATLAS_SEARCH_ENGINE_GREEN_URL',
};

function engineUrl(key: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PlatformError('VALIDATION_FAILED', 'A search engine URL is invalid.', {
      details: { setting: key },
    });
  }
  // Private hosts are reached over plain HTTP on the internal network only, at their root.
  if (
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new PlatformError('VALIDATION_FAILED', 'A search engine URL is invalid.', {
      details: { setting: key },
    });
  }
  return url;
}

/**
 * Where the per-slot search engine hosts listen, read from the platform's own environment.
 *
 * A slot without a configured host simply has no search engine: search reports itself as not
 * installed rather than failing the process, so a basemap-only deployment keeps working.
 */
export function readSearchEngines(
  environment: Readonly<Record<string, string | undefined>>,
): SearchEngines {
  const engines: Partial<Record<SlotName, URL>> = {};
  for (const [slot, key] of Object.entries(ENGINE_URL_KEYS) as [SlotName, string][]) {
    const value = environment[key];
    if (value !== undefined && value.length > 0) engines[slot] = engineUrl(key, value);
  }
  return engines;
}
