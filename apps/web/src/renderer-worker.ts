import { setWorkerUrl } from 'maplibre-gl';
// Vite bundles the renderer's worker and returns the URL of the emitted asset. Without this the
// renderer derives the worker URL from its own module URL at runtime, which after bundling
// points at a file that was never emitted: the worker then fails to start and every tile and
// glyph request hangs with no error.
import rendererWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let configured = false;

/** Points the renderer at its bundled, same-origin worker. Safe to call repeatedly. */
export function configureRendererWorker(): void {
  if (configured) return;
  configured = true;
  setWorkerUrl(rendererWorkerUrl);
}
