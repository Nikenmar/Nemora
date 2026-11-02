import { describe, expect, it } from 'vitest';
// The app loads the store first (appReducer and utils/localStorage import each other through it).
import '@renderer/store';
import { DEFAULT_REDUCER_DATA, reducer, type AppReducerStateActions } from '@renderer/other/appReducer';

/**
 * PLAN/21 P21.0: the app reducer, frozen. Every action runs from the default state (a fresh deep
 * copy each time, since some cases mutate it in place) and the resulting state is the snapshot of
 * today's behaviour, including the in-place page data update (BUGS 2026-11-02).
 */
const fresh = () => structuredClone(DEFAULT_REDUCER_DATA);

const song = {
  songId: 's1',
  title: 'Song',
  artists: [{ artistId: 'a1', name: 'Artist' }],
  duration: 200,
  path: 'C:/music/song.flac',
  artworkPath: '',
  isAFavorite: false,
  isKnownSource: true,
  isBlacklisted: false
} as unknown as AudioPlayerData;

const actions: AppReducerStateActions[] = [
  { type: 'CURRENT_SONG_DATA_CHANGE', data: song },
  { type: 'UP_NEXT_SONG_DATA_CHANGE', data: song },
  { type: 'CURRENT_SONG_PLAYBACK_STATE', data: true },
  { type: 'ADD_NEW_NOTIFICATIONS', data: [{ id: 'n1', content: 'hello', duration: 3000 } as AppNotification] },
  { type: 'UPDATE_NOTIFICATIONS', data: [] },
  { type: 'CONTEXT_MENU_DATA_CHANGE', data: { isVisible: true, menuItems: [], pageX: 10, pageY: 20 } },
  { type: 'CONTEXT_MENU_VISIBILITY_CHANGE', data: false },
  { type: 'CURRENT_ACTIVE_PAGE_DATA_UPDATE', data: { keyword: 'abc', scrollTopOffset: 0 } },
  { type: 'UPDATE_PLAYER_TYPE', data: 'mini' },
  { type: 'UPDATE_VOLUME', data: { value: 40, isMuted: false } },
  { type: 'UPDATE_MUTED_STATE', data: true },
  { type: 'UPDATE_SONG_POSITION', data: 42.5 },
  { type: 'UPDATE_IS_REPEATING_STATE', data: 'repeat' },
  { type: 'TOGGLE_IS_FAVORITE_STATE', data: true },
  { type: 'TOGGLE_SHUFFLE_STATE', data: true },
  { type: 'TOGGLE_TIER_SHUFFLE_STATE', data: true },
  { type: 'UPDATE_VOLUME_VALUE', data: 70 },
  { type: 'UPDATE_QUEUE', data: { queue: ['a', 'b'], currentSongIndex: 1, queueType: 'songs' } as unknown as Queue },
  { type: 'TOGGLE_REDUCED_MOTION', data: true },
  { type: 'TOGGLE_SONG_INDEXING', data: true },
  { type: 'PLAYER_WAITING_STATUS', data: true },
  { type: 'UPDATE_BODY_BACKGROUND_IMAGE', data: 'url' },
  { type: 'UPDATE_BATTERY_POWER_STATE', data: true },
  { type: 'TOGGLE_SHOW_SONG_REMAINING_DURATION', data: true }
];

describe('appReducer', () => {
  for (const action of actions) {
    it(action.type, () => {
      expect(reducer(fresh(), action)).toMatchSnapshot();
    });
  }

  it('updates the page data in place (the object stays the same)', () => {
    const state = fresh();
    const page = state.currentlyActivePage;
    const next = reducer(state, { type: 'CURRENT_ACTIVE_PAGE_DATA_UPDATE', data: { keyword: 'x' } });
    expect(next.currentlyActivePage.data).toEqual({ keyword: 'x' });
    // Today's behaviour, which readers of live page data rely on selecting a primitive for.
    expect(next.currentlyActivePage === page || next.currentlyActivePage === next.navigationHistory.history[next.navigationHistory.pageHistoryIndex]).toBe(true);
  });

  it('leaves an unknown action alone', () => {
    const state = fresh();
    expect(reducer(state, { type: 'START_PLAY_STATE_CHANGE', data: null })).toEqual(state);
  });
});
