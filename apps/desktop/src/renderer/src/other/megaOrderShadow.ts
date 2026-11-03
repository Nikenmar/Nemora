/**
 * PLAN/21 P21.6: Smart Shuffle's order from the core, in shadow.
 *
 * The view orders the queue itself (`megaShuffleQueue`, the oracle) and plays that order. The same
 * random draws go to the core's port (`mega_order`), and any order that comes back different is
 * written to the shadow log (`nemora.shadow.megaOrder`, the last 50, and the console).
 *
 * The switch to the core's order waits until the log has stayed empty through the user's daily
 * use: it makes building a shuffled queue wait for the core's answer, so it is a change of its own,
 * not a flag here. The TypeScript order stays as the oracle until then.
 */
import { ipc } from '@platform/ipc';

import megaShuffleQueue from './megaShuffleQueue';

export const SHADOW_LOG_KEY = 'nemora.shadow.megaOrder';
const LOG_LIMIT = 50;
/** `Math.random` gives multiples of 2^-53: as whole numbers they cross JSON exactly. */
const SCALE = 2 ** 53;

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const log = (entry: { songs: number; firstDifference: number; detail: string }) => {
  try {
    const list = JSON.parse(localStorage.getItem(SHADOW_LOG_KEY) ?? '[]') as unknown[];
    localStorage.setItem(SHADOW_LOG_KEY, JSON.stringify([...list, { at: Date.now(), ...entry }].slice(-LOG_LIMIT)));
  } catch {
    /* a full or blocked storage: the console still has it */
  }
  console.warn(`[mega order shadow] ${entry.songs} songs, first difference at ${entry.firstDifference}: ${entry.detail}`);
};

/** `megaShuffleQueue`, unchanged, with its draws recorded and the core asked for the same order. */
const shadowedMegaShuffleQueue = (songIds: string[], data: MegaShuffleData, currentSongIndex?: number) => {
  const draws: number[] = [];
  const result = megaShuffleQueue(songIds, data, currentSongIndex, () => {
    const value = Math.random();
    draws.push(value);
    return value;
  });
  if (isTauri) {
    const draws53 = draws.map((value) => value * SCALE);
    // A draw that is not a whole multiple would not cross exactly: compared anyway, and said.
    const exact = draws53.every(Number.isInteger);
    ipc('mega_order', { songIds, data, currentIndex: currentSongIndex ?? null, draws53: draws53.map(Math.round) })
      .then((core) => {
        const same =
          core.shuffledQueue.length === result.shuffledQueue.length &&
          core.shuffledQueue.every((id, i) => id === result.shuffledQueue[i]) &&
          core.positions.every((p, i) => p === result.positions[i]);
        if (!same) {
          const firstDifference = core.shuffledQueue.findIndex((id, i) => id !== result.shuffledQueue[i]);
          log({ songs: songIds.length, firstDifference, detail: exact ? 'same draws' : 'draws not whole multiples of 2^-53' });
        }
      })
      .catch((error: unknown) => console.warn('[mega order shadow] the core did not answer', error));
  }
  return result;
};

export default shadowedMegaShuffleQueue;
