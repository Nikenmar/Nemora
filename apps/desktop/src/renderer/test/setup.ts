import { vi } from 'vitest';

/**
 * The renderer's modules reach the shell through `window.api` and `@tauri-apps/api/core` at import
 * and at run time. Here every such call is a recorded stub answering a resolved promise, so a
 * module imports and runs as in the app without Tauri; a test reads `apiCalls` to see what reached
 * the shell.
 */
export const apiCalls: { path: string; args: unknown[] }[] = [];

const stub = (path: string): unknown =>
  new Proxy(() => undefined, {
    get: (_target, key) => {
      if (key === 'then') return undefined;
      if (path === 'properties' && key === 'isInDevelopment') return false;
      return stub(path ? `${path}.${String(key)}` : String(key));
    },
    apply: (_target, _this, args) => {
      apiCalls.push({ path, args });
      return Promise.resolve(undefined);
    }
  });

(window as unknown as { api: unknown }).api = stub('');

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    apiCalls.push({ path: `invoke.${command}`, args: [args] });
    return undefined;
  })
}));
