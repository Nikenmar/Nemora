/**
 * Vite config for the Tauri build of the renderer.
 *
 * The Electron build keeps using electron.vite.config.ts and is unaffected:
 * both targets compile the SAME src/renderer sources, so a change to the UI
 * lands in both shells at once. That is the point of the parallel-tree
 * approach - `npm run build` must keep producing a working Electron app for the
 * entire duration of the port.
 *
 * Aliases are mirrored from electron.vite.config.ts on purpose; if one changes,
 * change the other.
 */
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';

const KUROMOJI_DICT = resolve(import.meta.dirname, 'node_modules/@sglkc/kuromoji/dict');

/**
 * Ships Kuromoji's dictionary as a static asset.
 *
 * Under Electron the analyzer resolved these twelve .dat.gz files straight out
 * of node_modules with a Node path. A webview can only fetch them over HTTP,
 * and Tauri answers a missing asset with index.html - so kuromoji gunzipped a
 * page of HTML, raised "invalid gzip data" twelve times, and then hung forever
 * because nothing rejected. Japanese romanization was dead in exactly the way
 * that leaves no useful error.
 */
function kuromojiDictionary(): Plugin {
  return {
    name: 'nora-kuromoji-dictionary',
    configureServer(server) {
      server.middlewares.use('/kuromoji-dict', (request, response, next) => {
        const name = (request.url ?? '').replace(/^\/+/, '').split('?')[0];
        const file = resolve(KUROMOJI_DICT, name);
        if (!name || !file.startsWith(KUROMOJI_DICT) || !existsSync(file)) return next();
        response.setHeader('Content-Type', 'application/gzip');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void import('node:fs').then(({ createReadStream }) => createReadStream(file).pipe(response));
      });
    },
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir || !existsSync(KUROMOJI_DICT)) return;
      cpSync(KUROMOJI_DICT, resolve(outDir, 'kuromoji-dict'), { recursive: true });
    }
  };
}

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  // Tauri serves the bundle from a custom scheme, so asset URLs must be relative.
  base: './',
  // The ported network core reads its API keys from import.meta.env.MAIN_VITE_*,
  // the same names electron-vite exposed to the main process. Vite only inlines
  // variables matching an allowed prefix, so MAIN_VITE_ has to be listed.
  //
  // These keys end up inside the renderer bundle. That is not a regression -
  // under Electron they were equally readable from the packaged asar - but it
  // does mean they are shipped secrets, not private ones.
  envPrefix: ['VITE_', 'MAIN_VITE_'],
  envDir: resolve(import.meta.dirname),
  plugins: [react(), kuromojiDictionary()],
  resolve: {
    alias: {
      // node-taglib-sharp calls path.extname/path.basename at runtime. Vite
      // externalises Node builtins for the browser, so those came back
      // undefined and every TagLib read threw `Path.extname is not a function`
      // - reported to the user as a corrupt file. Jest never saw it: it runs on
      // Node, where the real module exists.
      path: resolve(import.meta.dirname, './src/platform/core/tags/nodePathShim.ts'),
      '@renderer': resolve(import.meta.dirname, './src/renderer/src'),
      '@types': resolve(import.meta.dirname, './src/@types'),
      '@platform': resolve(import.meta.dirname, './src/platform'),
      '@common': resolve(import.meta.dirname, './src/common')
    }
  },
  // The metadata worker is a module worker that imports music-metadata, which
  // code-splits. Vite's default worker format is `iife`, and an IIFE bundle
  // cannot be split - so the production build fails outright while the dev
  // server, which serves workers as native ES modules, shows nothing wrong.
  // WebView2 is Chromium, so module workers are supported.
  worker: { format: 'es' },
  // Keep the dev server quiet and fixed: tauri.conf.json points devUrl at it.
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5274 } : undefined,
    watch: {
      // Rust rebuilds are driven by cargo, not by vite.
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    // Deliberately NOT out/renderer: electron.vite.config.ts writes there, and
    // running both builds at once had the Electron output overwrite these files
    // while Tauri's generate_context! macro was embedding them.
    outDir: resolve(import.meta.dirname, 'out/tauri-renderer'),
    emptyOutDir: true,
    // WebView2 tracks Edge, so there is no legacy browser to support here.
    target: 'chrome110',
    sourcemap: true
  }
});
