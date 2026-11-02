import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const here = import.meta.dirname;
// Snapshots hold local offsets (a play's utcOffsetMin): every machine runs them in UTC.
process.env.TZ = 'UTC';

// PLAN/21 P21.0: the renderer's characterisation tests. A config of its own, so the app's build
// (vite.config.ts) is untouched; the aliases are the same.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(here, 'src/renderer/src'),
      '@platform': resolve(here, 'src/platform'),
      '@common': resolve(here, 'src/common'),
      '@types': resolve(here, 'src/types')
    }
  },
  test: {
    root: here,
    include: ['src/renderer/test/**/*.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['src/renderer/test/setup.ts']
  }
});
