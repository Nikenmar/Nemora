import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'esnext' }
});
