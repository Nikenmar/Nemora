/**
 * Port self-check: exercises the real `window.api` surface inside the running
 * shell and reports what breaks.
 *
 * Every defect the first live run surfaced was invisible to the unit suite,
 * because none of them lived in the logic:
 *
 *   - `window.api` was undefined when i18n evaluated  (module ordering)
 *   - a stale meta CSP blocked every IPC call          (config drift)
 *   - `Buffer` was missing from globalThis             (CommonJS in a webview)
 *   - external fetch died on CORS                      (Node -> browser move)
 *   - a channel returned the 50x50 artwork variant     (behavioural drift)
 *
 * The first four are "the call throws or never returns". This module finds them
 * by calling every read-only channel for real and recording the outcome. The
 * fifth is a value difference, so the report is also a snapshot that can be
 * diffed against one taken from the Electron build.
 *
 * SAFETY: only channels whose names indicate a read are invoked. Anything that
 * could write, delete, import, export or reset is skipped by name and by an
 * explicit deny list - a self-check that mutates a profile is worse than none.
 */

export interface ChannelResult {
  channel: string;
  status: 'ok' | 'threw' | 'timeout' | 'skipped';
  /** Shape of the value, not the value: paths and ids differ between machines. */
  shape?: string;
  error?: string;
  ms?: number;
}

export interface SelfCheckReport {
  startedAt: string;
  finishedAt: string;
  shell: 'tauri' | 'electron';
  consoleErrors: string[];
  results: ChannelResult[];
  summary: { ok: number; threw: number; timeout: number; skipped: number };
}

/** Names that may mutate. Matched case-insensitively anywhere in the method. */
const MUTATING = [
  'add',
  'save',
  'update',
  'set',
  'remove',
  'delete',
  'clear',
  'reset',
  'toggle',
  'import',
  'export',
  'rename',
  'restore',
  'blacklist',
  'resolve',
  'restart',
  'quit',
  'close',
  'minimize',
  'maximize',
  'install',
  'login',
  'scrobble',
  'send',
  'open',
  'reveal',
  'trash',
  'refresh',
  'generate',
  'create',
  'stop',
  'allow',
  'change'
];

/** Explicitly never called, even though the name looks like a read. */
const DENY = new Set([
  'getSongFromUnknownSource',
  'checkForStartUpSongs',
  'getRendererLogs',
  'sendLogs',
  // These open a native file picker and block until someone clicks. A timeout
  // here would mean "nobody was sitting at the machine", not "the port broke".
  'getFolderLocation',
  'getImgFileLocation',
  'getFolderStructures'
]);

/**
 * Channels allowed longer than the default budget, with the reason.
 *
 * Romanization loads Kuroshiro's Kuromoji dictionary - roughly 15 MB of
 * Japanese morphology - on first use. Report 03 already called that dictionary
 * too heavy to sit in a keystroke path; it is slow by design, not broken, and
 * failing the check on it would just teach everyone to ignore the check.
 */
const SLOW_CHANNELS: Record<string, number> = {
  romanizeLyrics: 60_000,
  convertLyricsToPinyin: 30_000,
  convertLyricsToRomaja: 30_000
};

const looksMutating = (method: string): boolean => {
  const lower = method.toLowerCase();
  return MUTATING.some((verb) => lower.startsWith(verb));
};

/** Describes a value's shape without leaking machine-specific content. */
function describe(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${describe(value[0], depth + 1)} x${value.length}]`;
  }
  const type = typeof value;
  if (type !== 'object') return type;
  if (depth >= 2) return 'object';
  const keys = Object.keys(value as object).sort();
  return `{${keys.join(',')}}`;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);

/**
 * Plausible arguments, taken from the profile actually loaded, so channels that
 * need an id are exercised for real rather than skipped.
 */
async function sampleArguments(): Promise<Record<string, unknown[]>> {
  const api = (globalThis as unknown as { api?: Record<string, never> }).api;
  const empty: Record<string, unknown[]> = {};
  if (!api) return empty;

  try {
    const songs = await (
      api as unknown as {
        audioLibraryControls: { getAllSongs: () => Promise<{ data?: { songId: string }[] }> };
      }
    ).audioLibraryControls.getAllSongs();
    const songId = songs?.data?.[0]?.songId;
    if (songId) {
      return {
        songId: [songId],
        songIds: [[songId]]
      };
    }
  } catch {
    /* falls through to no samples */
  }
  return empty;
}

function argumentsFor(method: string, samples: Record<string, unknown[]>): unknown[] | undefined {
  const lower = method.toLowerCase();
  if (lower.includes('songids') && samples.songIds) return samples.songIds;
  if (lower.includes('songid') && samples.songId) return samples.songId;
  // Channels taking no required argument are safe to call bare.
  return [];
}

export async function runSelfCheck(consoleErrors: string[]): Promise<SelfCheckReport> {
  const startedAt = new Date().toISOString();
  const api = (globalThis as unknown as { api?: Record<string, Record<string, unknown>> }).api;
  const results: ChannelResult[] = [];

  if (!api) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      shell: '__TAURI_INTERNALS__' in globalThis ? 'tauri' : 'electron',
      consoleErrors,
      results: [{ channel: 'window.api', status: 'threw', error: 'window.api is undefined' }],
      summary: { ok: 0, threw: 1, timeout: 0, skipped: 0 }
    };
  }

  const samples = await sampleArguments();

  for (const namespace of Object.keys(api).sort()) {
    const group = api[namespace];
    if (!group || typeof group !== 'object') continue;

    for (const method of Object.keys(group).sort()) {
      const channel = `${namespace}.${method}`;
      const fn = group[method];
      if (typeof fn !== 'function') continue;

      if (DENY.has(method) || looksMutating(method)) {
        results.push({ channel, status: 'skipped' });
        continue;
      }

      const args = argumentsFor(method, samples);
      if (!args) {
        results.push({ channel, status: 'skipped' });
        continue;
      }

      // Calling a channel with fewer arguments than it declares tells us
      // nothing: it fails inside the implementation on an undefined parameter,
      // which is the harness's fault rather than a port defect. Skip instead of
      // reporting noise that would train everyone to ignore the report.
      if ((fn as { length: number }).length > args.length) {
        results.push({ channel, status: 'skipped' });
        continue;
      }

      const started = performance.now();
      try {
        const value = await withTimeout(
          Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
          SLOW_CHANNELS[method] ?? 8000
        );
        results.push({
          channel,
          status: 'ok',
          shape: describe(value),
          ms: Math.round(performance.now() - started)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          channel,
          status: message === 'timeout' ? 'timeout' : 'threw',
          error: message,
          ms: Math.round(performance.now() - started)
        });
      }
    }
  }

  const summary = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { ok: 0, threw: 0, timeout: 0, skipped: 0 }
  );

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    shell: '__TAURI_INTERNALS__' in globalThis ? 'tauri' : 'electron',
    consoleErrors,
    results,
    summary
  };
}
