/**
 * Where the playing song was, for the next start of the app: saved every few seconds while it plays
 * and on every pause and seek, in its own small key (the main local storage holds the whole queue,
 * too heavy to rewrite this often), and read back once at start-up.
 */

const KEY = 'nemora.resumePosition';
/** At most one write this often while the song plays. */
const EVERY_MS = 4000;

let lastWrite = 0;

/** Remembers `position` (seconds) in `songId`; `now` skips the throttle (pause, seek, quit). */
export const rememberPosition = (songId: string | undefined, position: number, now = false) => {
  if (!songId || !Number.isFinite(position)) return;
  const at = performance.now();
  if (!now && at - lastWrite < EVERY_MS) return;
  lastWrite = at;
  try {
    localStorage.setItem(KEY, JSON.stringify({ songId, position }));
  } catch {
    // A full or blocked storage only loses the resume point.
  }
};

/** The position remembered in `songId`, if the last song remembered is that one. */
export const rememberedPosition = (songId: string): number | undefined => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { songId?: string; position?: number } | null;
    return saved?.songId === songId && typeof saved.position === 'number' ? saved.position : undefined;
  } catch {
    return undefined;
  }
};
