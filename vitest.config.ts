import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@atlas-os/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@atlas-os/platform': fileURLToPath(
        new URL('./packages/atlas-os/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    coverage: { reporter: ['text', 'html'] },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
