/**
 * Minimal Windows-style path join for user-selected and profile paths.
 *
 * The port must not depend on Node's `path` module. Nora targets Windows
 * (`%APPDATA%\Nora`, win32 path semantics everywhere), so a pure string join
 * with backslash separators is sufficient for the export/backup destinations
 * and legacy export folders this subsystem touches.
 */

export const joinPath = (...segments: string[]): string => {
  let result = segments[0] ?? '';
  for (let i = 1; i < segments.length; i += 1) {
    const trimmed = (segments[i] ?? '').replace(/^[\\/]+/, '');
    if (trimmed === '') continue;
    const endsWithSeparator = result.endsWith('\\') || result.endsWith('/');
    result = endsWithSeparator ? result + trimmed : `${result}\\${trimmed}`;
  }
  return result;
};
