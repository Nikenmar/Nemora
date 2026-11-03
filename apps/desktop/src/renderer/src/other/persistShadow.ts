/**
 * PLAN/21 P21.4: the view's local state in the core, slice by slice - in shadow.
 *
 * The view keeps its state in one webview `localStorage` blob (`utils/localStorage.ts`). Each slice
 * is now also written to the core (`persist_write`: device settings `view.<slice>`, and the queue
 * as the core's `queue_items`), and at every start the core's copy, written by the last session,
 * is compared with the blob the view loaded (`persist_read`). Every difference goes to the shadow
 * log (`nemora.persist.shadowLog`, the last 50, and the console).
 *
 * The blob stays the source. The switch, `nemora.persist.readFromCore` = "1" in localStorage, makes
 * the start read the slices from the core instead; it is off, and stays off until the shadow log
 * has stayed empty through the user's daily use. The blob is kept a release after that.
 */
import { ipc } from '@platform/ipc';
import { registerFlush } from '@platform/runtime/flush';

import { LOADED_LOCAL_STORAGE_TEXT, dispatch, store } from '../store';

export const SLICES = [
  'preferences',
  'playback',
  'queue',
  'ignoredSeparateArtists',
  'ignoredSongsWithFeatArtists',
  'ignoredDuplicates',
  'sortingStates',
  'equalizerPreset',
  'lyricsEditorSettings',
  'duels'
] as const satisfies readonly (keyof LocalStorage)[];

export const READ_FROM_CORE_KEY = 'nemora.persist.readFromCore';
export const SHADOW_LOG_KEY = 'nemora.persist.shadowLog';
const LOG_LIMIT = 50;
const WRITE_DELAY_MS = 1500;
/** How long a quit waits for the last write. */
const FLUSH_TIMEOUT_MS = 2000;

/** The core's copy, parsed: each slice the core has, and its own queue. */
type CoreSlices = Partial<Record<(typeof SLICES)[number], unknown>> & {
  coreQueue?: { songIds: string[]; index: number; positionMs: number } | null;
};
export type ShadowEntry = { at: number; slice: string; detail: string };

/** JSON with object keys sorted: the core keeps keys in its own order. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );

/** Where the core's copy and the blob differ, slice by slice (empty: they agree). */
export const compareSlices = (blob: LocalStorage, core: CoreSlices): Omit<ShadowEntry, 'at'>[] => {
  const out: Omit<ShadowEntry, 'at'>[] = [];
  for (const slice of SLICES) {
    if (!(slice in core)) {
      out.push({ slice, detail: 'not in the core' });
      continue;
    }
    const a = canonical(blob[slice]);
    const b = canonical(core[slice]);
    if (a !== b) out.push({ slice, detail: `blob ${a.slice(0, 200)} | core ${b.slice(0, 200)}` });
  }
  // The core's own queue: the blob's songs (a version's view id as its song) in order.
  const songs = (blob.queue?.queue ?? []).map((id) => id.split(':')[0]);
  const coreSongs = core.coreQueue?.songIds ?? [];
  if (canonical(songs) !== canonical(coreSongs)) {
    out.push({ slice: 'queue_items', detail: `blob ${songs.length} songs | core ${coreSongs.length}` });
  }
  return out;
};

const readLog = (): ShadowEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(SHADOW_LOG_KEY) ?? '[]') as ShadowEntry[];
  } catch {
    return [];
  }
};

const appendLog = (entries: Omit<ShadowEntry, 'at'>[]) => {
  if (entries.length === 0) return;
  const at = Date.now();
  try {
    const log = [...readLog(), ...entries.map((e) => ({ ...e, at }))].slice(-LOG_LIMIT);
    localStorage.setItem(SHADOW_LOG_KEY, JSON.stringify(log));
  } catch {
    /* a full or blocked storage: the console still has it */
  }
  for (const entry of entries) console.warn(`[persist shadow] ${entry.slice}: ${entry.detail}`);
};

const written = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** The slices that changed since the last write go to the core now; resolves when written. */
const writeNow = (): Promise<void> => {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const storage = store.state.localStorage;
  const slices: Record<string, string> = {};
  for (const slice of SLICES) {
    // As JSON text: the core keeps it as written, so it comes back exactly.
    const text = JSON.stringify(storage[slice]) ?? 'null';
    if (written.get(slice) !== text) {
      slices[slice] = text;
      written.set(slice, text);
    }
  }
  // The core's queue takes its position from the playback slice: they go together.
  if ('queue' in slices && !('playback' in slices)) slices.playback = JSON.stringify(storage.playback) ?? 'null';
  if (Object.keys(slices).length === 0) return Promise.resolve();
  return ipc('persist_write', { slices }).catch((error: unknown) => {
    // Written again with the next change.
    for (const slice of Object.keys(slices)) written.delete(slice);
    console.warn('[persist shadow] write failed', error);
  });
};

/** ...a moment after the last change. */
const scheduleWrite = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void writeNow(), WRITE_DELAY_MS);
};

let started = false;

/**
 * Compares the core's copy with the blob the view started from, then writes every change. With
 * the switch on, the slices the core has replace the blob's at this start.
 */
export const startPersistShadow = async (): Promise<void> => {
  if (started) return;
  started = true;
  let blob: LocalStorage = store.state.localStorage;
  try {
    if (LOADED_LOCAL_STORAGE_TEXT) blob = JSON.parse(LOADED_LOCAL_STORAGE_TEXT) as LocalStorage;
  } catch {
    /* an unreadable blob: the store's state, which the app started from */
  }
  try {
    const persisted = await ipc('persist_read');
    const core: CoreSlices = { coreQueue: persisted.coreQueue };
    for (const slice of SLICES) {
      const text = persisted.slices[slice];
      if (text !== undefined) Object.assign(core, { [slice]: JSON.parse(text) as unknown });
    }
    // The first start with the shadow: the core has nothing yet, which is no difference.
    const known = SLICES.some((slice) => slice in core);
    if (known) appendLog(compareSlices(blob, core));
    if (known && localStorage.getItem(READ_FROM_CORE_KEY) === '1') {
      const fromCore: Partial<LocalStorage> = {};
      for (const slice of SLICES) if (slice in core) Object.assign(fromCore, { [slice]: core[slice] });
      dispatch({ type: 'UPDATE_LOCAL_STORAGE', data: { ...store.state.localStorage, ...fromCore } });
    }
  } catch (error) {
    console.warn('[persist shadow] read failed', error);
  }
  store.subscribe(scheduleWrite);
  // A change in the last moment before a quit, a reload or a relaunch (the app writes playback
  // as it quits) is written before it goes; a window torn down otherwise, as it goes.
  registerFlush(() =>
    Promise.race([writeNow(), new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))])
  );
  window.addEventListener('pagehide', () => void writeNow());
  scheduleWrite();
};
