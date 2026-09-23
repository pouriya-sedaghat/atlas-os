import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The browser only ever talks to its own origin. In development and in the preview server Vite
 * proxies the two local API surfaces; in production the gateway does the same, so application
 * code is identical in every environment.
 *
 * The target and preview port are configurable so an end-to-end run can start a second
 * same-origin stack — for example one backed by a host that has no dataset installed.
 */
const apiTarget = process.env['ATLAS_WEB_API_TARGET'] ?? 'http://127.0.0.1:3000';
const previewPort = Number(process.env['ATLAS_WEB_PREVIEW_PORT'] ?? 4173);

const proxy = {
  '/api': {
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
    target: apiTarget,
  },
  '/maps': { changeOrigin: false, target: apiTarget },
};

export default defineConfig({
  build: {
    // The renderer is a large single dependency; raising the warning threshold keeps the build
    // output honest rather than splitting it into chunks that gain nothing on a local host.
    chunkSizeWarningLimit: 1_600,
  },
  plugins: [react()],
  // The renderer's worker is an ES module, so the emitted worker bundle must be one too.
  worker: { format: 'es' },
  preview: { host: '127.0.0.1', port: previewPort, proxy, strictPort: true },
  server: { host: '127.0.0.1', port: 5173, proxy, strictPort: true },
});
