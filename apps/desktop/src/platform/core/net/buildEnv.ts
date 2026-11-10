/**
 * Build-time environment access for the ported network core.
 *
 * The Electron main process read its API keys from `import.meta.env.MAIN_VITE_*`
 * variables. The Tauri renderer gets them the same way: the renderer's vite
 * build must expose the `MAIN_VITE_*` variables through `define` or an env
 * prefix mapping so `import.meta.env.MAIN_VITE_*` resolves in the webview.
 *
 * Required variable names (see docs/tauri-port/03-main-logic-port.md §1):
 *   MAIN_VITE_LAST_FM_API_KEY
 *
 * NOTE: this module intentionally keeps the literal `import.meta.env` access so
 * Vite's static replacement applies. (A `@ts-ignore` for ts-jest, which compiled
 * to CommonJS, stood here; jest is gone and Vitest runs ESM.)
 */
const readViteEnv = () => import.meta.env;

let envOverride: Record<string, string | undefined> | undefined;

/**
 * Test-only override; passing undefined restores the real Vite environment.
 * Production code never calls this — the api-bridge wires the real env.
 */
export const setBuildEnvOverrideForTests = (
  env: Record<string, string | undefined> | undefined
): void => {
  envOverride = env;
};

/** Reads one build-time variable (`MAIN_VITE_*`), or undefined when absent. */
export const getBuildEnvVariable = (name: string): string | undefined => {
  if (envOverride) return envOverride[name];
  const env = readViteEnv();
  return typeof env === 'object' && env !== null ? (env[name] as string | undefined) : undefined;
};
