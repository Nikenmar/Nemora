/// <reference types="vite/client" />

/**
 * Electron augments the DOM `File` with an absolute `path`, which is how the
 * drag-and-drop handler in App.tsx learns where a dropped track lives.
 *
 * WebView2 does not: `path` is genuinely absent there, so it is declared
 * optional rather than pretended into existence. Under Tauri the real paths
 * arrive through the webview's own drag-drop event instead, which carries file
 * system paths; see src/platform/shell.
 */
interface File {
  readonly path?: string;
}
