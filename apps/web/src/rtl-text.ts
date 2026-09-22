import { setRTLTextPlugin } from 'maplibre-gl';

import { once } from './once.js';

/**
 * Served from this origin. The renderer loads the plugin as a classic script in a worker, so it
 * cannot be bundled; `scripts/vendor-web-assets.mjs` copies it from the pinned dependency into
 * the static directory. No plugin CDN is contacted.
 */
export const RTL_TEXT_PLUGIN_URL = '/vendor/mapbox-gl-rtl-text.js';

/**
 * Shared initialisation of right-to-left text shaping.
 *
 * The renderer's plugin registry is global and rejects a second registration, so initialisation
 * is memoised as a single promise: concurrent callers and React's development double-mount all
 * await the *same* load rather than a later caller returning early while the first is still in
 * flight. A map must not be constructed before shaping is ready, or Persian labels render
 * unshaped.
 *
 * A failure is propagated rather than swallowed — a map that cannot shape Persian text must not
 * present itself as a ready Persian map — and is not memoised, so a later mount can retry.
 */
const initialize = once(async () => {
  try {
    await setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, false);
  } catch (cause) {
    throw new Error(
      'Right-to-left text shaping could not be initialised, so Persian labels would render ' +
        'incorrectly.',
      { cause },
    );
  }
});

export function ensureRtlTextPlugin(): Promise<void> {
  return initialize();
}

/** Whether initialisation is in flight or has succeeded. False after a failure. */
export function rtlTextPluginRequested(): boolean {
  return initialize.started;
}
