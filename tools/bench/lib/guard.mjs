/**
 * Proof that a run touched nothing of the user's.
 *
 * Every launch is bracketed by a fingerprint of the places a player writes when it is NOT isolated:
 * the real profiles of both players, Nemora's WebView2 state, Nora's updater cache, the protocol
 * handler and autostart entries in the registry. Any difference fails the run loudly. It only works
 * when the real players are closed, which is also what a fair measurement needs, so that is checked
 * before anything starts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPDATA = process.env.APPDATA ?? '';
const LOCAL = process.env.LOCALAPPDATA ?? '';

const WATCHED_DIRS = [
  join(APPDATA, 'Nemora'),
  join(APPDATA, 'Nemora-dev'),
  join(APPDATA, 'Nora'),
  join(LOCAL, 'com.cmrdevs.nemora'),
  join(LOCAL, 'nora-updater')
];
const WATCHED_KEYS = [
  'HKCU\\Software\\Classes\\nora',
  'HKCU\\Software\\Classes\\nemora',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else
      try {
        const s = statSync(full);
        out.set(full, `${s.size}:${Math.round(s.mtimeMs)}`);
      } catch {
        /* vanished */
      }
  }
}

const registry = (key) =>
  spawnSync('reg', ['query', key, '/s'], { encoding: 'utf8' }).stdout?.replace(/\r/g, '').trim() ?? '';

export function createGuard() {
  return {
    dirs: WATCHED_DIRS.filter(existsSync),
    fingerprint() {
      const files = new Map();
      for (const dir of WATCHED_DIRS) if (existsSync(dir)) walk(dir, files);
      const keys = Object.fromEntries(WATCHED_KEYS.map((key) => [key, registry(key)]));
      return { files, keys };
    },
    /** What changed between two fingerprints, as readable lines. */
    compare(a, b) {
      const changes = [];
      for (const [path, stamp] of b.files) {
        if (!a.files.has(path)) changes.push(`created ${path}`);
        else if (a.files.get(path) !== stamp) changes.push(`changed ${path}`);
      }
      for (const path of a.files.keys()) if (!b.files.has(path)) changes.push(`deleted ${path}`);
      for (const key of Object.keys(a.keys)) if (a.keys[key] !== b.keys[key]) changes.push(`registry ${key}`);
      return changes;
    }
  };
}

/**
 * Players running now, the user's own or a leftover from an interrupted run: either would share the
 * machine with the measurement and change the fingerprint under it.
 */
export function runningPlayers() {
  const out = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process -Name nemora,nemora-desktop,Nora -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"
    ],
    { encoding: 'utf8' }
  ).stdout;
  return [...new Set((out ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
}
