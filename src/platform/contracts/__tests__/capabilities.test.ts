import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every window command the renderer calls must be granted in the capability
 * file, and the failure when one is not is silent in exactly the way that costs
 * a day.
 *
 * That is not hypothetical either. `toggleMaximize()` was called by the
 * titlebar button and never granted: Tauri rejects the promise with
 * "Command plugin:window|toggle_maximize not allowed by ACL", the call site
 * discards the promise with `void`, and the button simply does nothing. Nothing
 * fails to compile, no unit test goes red, and the only trace is an unhandled
 * rejection in the log file. `unminimize()` had the same hole on the
 * "Open with" path, where it would have aborted the file-opening handler
 * whenever the window happened to be minimized.
 *
 * So this is a string comparison across config files rather than a unit test of
 * logic, for the same reason scheme.test.ts is: that seam is where the drift
 * happens, and the compiler does not watch it.
 *
 * The rule is "listed explicitly", not "granted somehow". Some of these are in
 * the `core:window:default` set already, but that set is Tauri's to change on
 * any upgrade, and it is generated into `src-tauri/gen/` which is gitignored -
 * a test that read it would be untestable in CI and would go quiet the day the
 * set shrank. Listing a permission twice costs nothing.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), 'utf8');

/**
 * Not ACL-gated commands: these subscribe to window events, which are covered
 * by `core:event:default`. They are named here rather than detected, because
 * detection would need the generated ACL manifest.
 */
const EVENT_SUBSCRIPTIONS = new Set([
  'onMoved',
  'onResized',
  'onScaleChanged',
  'onThemeChanged',
  'onFocusChanged',
  'onCloseRequested'
]);

/** The modules that own every call into the Tauri window API. */
const CALL_SITES = [
  ['src', 'platform', 'shell', 'tauri.ts'],
  ['src', 'platform', 'api', 'window-controls.ts']
] as const;

const toPermission = (method: string) =>
  `core:window:allow-${method.replace(/(?<!^)(?=[A-Z])/gu, '-').toLowerCase()}`;

const calledMethods = (): string[] => {
  const methods = new Set<string>();
  for (const segments of CALL_SITES) {
    const source = read(...segments);
    for (const [, method] of source.matchAll(/\b(?:window|appWindow)\.([a-zA-Z]+)\(/gu)) {
      if (!EVENT_SUBSCRIPTIONS.has(method)) methods.add(method);
    }
  }
  return [...methods].sort();
};

const granted = (): Set<string> => {
  const capability = JSON.parse(read('src-tauri', 'capabilities', 'default.json')) as {
    permissions: (string | { identifier: string })[];
  };
  return new Set(
    capability.permissions.filter((entry): entry is string => typeof entry === 'string')
  );
};

describe('window commands the renderer calls are granted by the capability file', () => {
  test('the call sites are found at all, so an empty match cannot pass silently', () => {
    // A regex that stops matching would otherwise turn this whole suite green.
    expect(calledMethods().length).toBeGreaterThan(15);
    expect(calledMethods()).toContain('toggleMaximize');
  });

  test('every called window method has an explicit allow entry', () => {
    const permissions = granted();
    const missing = calledMethods()
      .map((method) => ({ method, permission: toPermission(method) }))
      .filter(({ permission }) => !permissions.has(permission));

    expect(missing).toEqual([]);
  });
});
