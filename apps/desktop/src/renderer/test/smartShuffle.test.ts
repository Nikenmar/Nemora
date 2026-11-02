import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store, dispatch } from '@renderer/store';
import storage from '@renderer/utils/localStorage';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from '@renderer/other/appReducer';
import {
  NO_STEERING,
  reasonsOf,
  reorderRemaining,
  shuffleOptions,
  smartShuffleData,
  steer,
  steeringStore,
  type SteeringAction
} from '@renderer/other/smartShuffle';

/**
 * PLAN/21 P21.0: Smart Shuffle's renderer side, frozen: reordering the rest of the queue (the
 * played part and the current song stay, queueBeforeShuffle follows), every steering action's
 * state, the options read from the preferences, and the reasons read from an explanation.
 */
const seeded = (seed: number) => {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
};

const songs = Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, '0')}`);

describe('smartShuffle', () => {
  beforeEach(() => {
    storage.setAllItems(structuredClone(LOCAL_STORAGE_DEFAULT_TEMPLATE));
    steeringStore.setState(() => NO_STEERING);
    smartShuffleData.current = {
      weights: Object.fromEntries(songs.map((id, i) => [id, 0.2 + (i % 5) / 5])),
      pairFeedback: []
    } as unknown as MegaShuffleData;
    const random = seeded(11);
    vi.spyOn(Math, 'random').mockImplementation(random);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reorders only what has not played yet and keeps the restore order composed', () => {
    storage.queue.setQueue({
      ...LOCAL_STORAGE_DEFAULT_TEMPLATE.queue,
      queue: [...songs],
      currentSongIndex: 4,
      queueBeforeShuffle: songs.map((_, i) => i)
    });
    steeringStore.setState((s) => ({ ...s, notNow: ['s10'] }));
    reorderRemaining();
    const q = store.state.localStorage.queue;
    expect(q.queue.slice(0, 5)).toEqual(songs.slice(0, 5));
    expect(q.queue.at(-1)).toBe('s10');
    expect([...q.queue].sort()).toEqual([...songs].sort());
    expect({ queue: q.queue, queueBeforeShuffle: q.queueBeforeShuffle }).toMatchSnapshot();
  });

  it('does nothing when the current song is the last', () => {
    storage.queue.setQueue({ ...LOCAL_STORAGE_DEFAULT_TEMPLATE.queue, queue: ['a', 'b'], currentSongIndex: 1 });
    reorderRemaining();
    expect(store.state.localStorage.queue.queue).toEqual(['a', 'b']);
  });

  it('applies every steering action to its state', async () => {
    dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
    const actions: SteeringAction[] = [
      { kind: 'lessArtist', artist: 'A' },
      { kind: 'lessArtist', artist: 'A' },
      { kind: 'moreLike', songId: 's01', title: 'One' },
      { kind: 'notNow', songId: 's02', title: 'Two' },
      { kind: 'filter', filter: 'onlyUnheard', isOn: true },
      { kind: 'remove', what: 'lessArtists', value: 'A' },
      { kind: 'mode', mode: 'comfort' as ShuffleMode },
      { kind: 'lens', lens: 't1', songs: ['s03'], name: 'Lens' },
      { kind: 'follow', on: true, name: 'Map' }
    ];
    const states: unknown[] = [];
    for (const action of actions) {
      await steer(action);
      states.push(structuredClone(steeringStore.state));
    }
    expect(states).toMatchSnapshot();
    await steer({ kind: 'clear' });
    expect(steeringStore.state).toEqual(NO_STEERING);
  });

  it('reads its options from the preferences', () => {
    expect(shuffleOptions()).toMatchSnapshot();
    storage.preferences.setPreferences('isSkipAwareDisabled', true);
    storage.preferences.setPreferences('isNightShuffleEnabled', true);
    storage.preferences.setPreferences('isEnergyFlowEnabled', true);
    expect(shuffleOptions()).toMatchSnapshot();
  });

  it('reads reasons from an explanation', () => {
    const explanation = {
      songId: 's01',
      parts: { tier: 1, artist: 0.5, elo: 0.7, listens: 0.3, freshness: 0.6, rotation: 1.3, fatigue: 0.8, memory: 1.4, night: 1.1, engagement: 0.7, nudge: 0.02, confidence: 0.5, explored: 0.1, score: 0.8 },
      tier: { name: 'S', tierlist: 'Best' },
      lastPlayedDay: '2026-10-20',
      fullListens: 12,
      skips: 3
    } as unknown as ShuffleExplanation;
    expect(reasonsOf(explanation)).toMatchSnapshot();
  });
});
