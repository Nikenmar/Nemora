import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and must see Rust compiler errors, so Vite neither clears the
// screen nor falls back to another port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist', target: 'chrome120' }
});
