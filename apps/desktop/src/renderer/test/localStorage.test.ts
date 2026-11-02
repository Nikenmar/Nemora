import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '@renderer/store';
import storage from '@renderer/utils/localStorage';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from '@renderer/other/appReducer';

/**
 * PLAN/21 P21.0: the local-storage monolith, frozen before P21.4 replaces it. What each setter
 * writes to `localStorage` (the whole blob) and to the store, how a missing or old blob is repaired
 * and migrated, and what the getters answer.
 */
const blob = () => JSON.parse(localStorage.getItem('localStorage') ?? 'null') as LocalStorage;

describe('utils/localStorage', () => {
  beforeEach(() => {
    storage.resetLocalStorage();
    storage.setAllItems(structuredClone(LOCAL_STORAGE_DEFAULT_TEMPLATE));
  });

  it('starts from the default template, version stamped', () => {
    expect(blob()).toEqual(LOCAL_STORAGE_DEFAULT_TEMPLATE);
    expect(localStorage.getItem('version')).toBeTruthy();
  });

  it('writes a preference to the blob and the store together', () => {
    storage.preferences.setPreferences('isNightShuffleEnabled', true);
    expect(blob().preferences.isNightShuffleEnabled).toBe(true);
    expect(store.state.localStorage.preferences.isNightShuffleEnabled).toBe(true);
    expect(storage.preferences.getPreferences('isNightShuffleEnabled')).toBe(true);
  });

  it('keeps every slice in one blob: a queue write rewrites the preferences too', () => {
    storage.preferences.setPreferences('tierShuffleIntensity', 0.8);
    storage.queue.setQueue({ ...LOCAL_STORAGE_DEFAULT_TEMPLATE.queue, queue: ['a', 'b', 'c'], currentSongIndex: 1 });
    storage.queue.setCurrentSongIndex(2);
    const saved = blob();
    expect(saved.queue.queue).toEqual(['a', 'b', 'c']);
    expect(saved.queue.currentSongIndex).toBe(2);
    expect(saved.preferences.tierShuffleIntensity).toBe(0.8);
    expect(storage.queue.getQueue().currentSongIndex).toBe(2);
  });

  it('writes every slice through its own setter', () => {
    storage.playback.setPlaybackOptions('isRepeating', 'repeat' as never);
    storage.playback.setVolumeOptions('value', 33 as never);
    storage.sortingStates.setSortingStates('songsPage', 'dateAddedDescending' as never);
    storage.equalizerPreset.setEqualizerPreset({ ...LOCAL_STORAGE_DEFAULT_TEMPLATE.equalizerPreset, sixtyHertzFilter: 3 } as never);
    storage.ignoredSeparateArtists.setIgnoredSeparateArtists(['x']);
    storage.ignoredSongsWithFeatArtists.setIgnoredSongsWithFeatArtists(['y']);
    expect(blob()).toMatchSnapshot();
  });

  it('repairs a missing or unversioned blob to the template', () => {
    localStorage.removeItem('version');
    localStorage.setItem('localStorage', '{"broken": true}');
    storage.checkLocalStorage();
    expect(blob()).toEqual(LOCAL_STORAGE_DEFAULT_TEMPLATE);
  });

  it('adds missing keys to an old blob and keeps its values', () => {
    const old = structuredClone(LOCAL_STORAGE_DEFAULT_TEMPLATE) as unknown as Record<string, unknown>;
    delete old.duels;
    (old.preferences as Record<string, unknown>).isNightShuffleEnabled = true;
    localStorage.setItem('localStorage', JSON.stringify(old));
    storage.checkLocalStorage();
    const repaired = blob();
    expect(repaired.duels).toEqual(LOCAL_STORAGE_DEFAULT_TEMPLATE.duels);
    expect(repaired.preferences.isNightShuffleEnabled).toBe(true);
  });

  it('reads the template when the blob is not JSON', () => {
    localStorage.setItem('localStorage', '{not json');
    expect(storage.getLocalStorage()).toEqual(LOCAL_STORAGE_DEFAULT_TEMPLATE);
  });
});
