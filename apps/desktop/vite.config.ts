import { cpSync, createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig, type Plugin } from 'vite';

const here = import.meta.dirname;
const KUROMOJI_DICT = resolve(here, 'node_modules/@sglkc/kuromoji/dict');

// Kuromoji fetches its dictionary over HTTP in a webview. Tauri answers a missing asset with
// index.html, which kuromoji then fails to gunzip and hangs on, so the files are served in dev and
// copied into the bundle.
function kuromojiDictionary(): Plugin {
  return {
    name: 'nemora-kuromoji-dictionary',
    configureServer(server) {
      server.middlewares.use('/kuromoji-dict', (request, response, next) => {
        const name = (request.url ?? '').replace(/^\/+/, '').split('?')[0];
        const file = resolve(KUROMOJI_DICT, name);
        if (!name || !file.startsWith(KUROMOJI_DICT) || !existsSync(file)) return next();
        response.setHeader('Content-Type', 'application/gzip');
        createReadStream(file).pipe(response);
      });
    },
    writeBundle(options) {
      if (options.dir && existsSync(KUROMOJI_DICT)) {
        cpSync(KUROMOJI_DICT, resolve(options.dir, 'kuromoji-dict'), { recursive: true });
      }
    }
  };
}

// Tauri expects a fixed dev port and must see Rust compiler errors, so Vite neither clears the
// screen nor falls back to another port.
export default defineConfig({
  root: resolve(here, 'src/renderer'),
  // Tauri serves the bundle from its own scheme, so asset URLs are relative.
  base: './',
  envPrefix: ['VITE_', 'MAIN_VITE_'],
  envDir: here,
  plugins: [react(), kuromojiDictionary()],
  resolve: {
    alias: {
      '@renderer': resolve(here, 'src/renderer/src'),
      '@platform': resolve(here, 'src/platform'),
      '@common': resolve(here, 'src/common'),
      '@types': resolve(here, 'src/types')
    }
  },
  worker: { format: 'es' },
  clearScreen: false,
  server: { port: 5273, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'chrome120', sourcemap: true }
});
