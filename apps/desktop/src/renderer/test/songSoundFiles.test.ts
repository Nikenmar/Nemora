import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { apiCalls } from './setup';
import { store } from '@renderer/store';
import storage from '@renderer/utils/localStorage';

/**
 * Switch version's sound and the song's file: the library hears at once; a file the engine has open
 * (the song playing, the next one opened ahead) waits until the engine has let it go; the setting
 * keeps everything out of the files.
 */
type Module = typeof import('@renderer/other/songSound');
let songSound: Module;

const sets = () =>
  apiCalls
    .filter((c) => c.path === 'invoke.song_sound_set')
    .map((c) => c.args[0] as { songId: string; sound: unknown; writeFile: boolean });
const files = () => sets().filter((c) => c.writeFile).map((c) => [c.songId, c.sound === null ? 'removed' : 'sound']);
const library = () => sets().filter((c) => !c.writeFile).map((c) => c.songId);
const sound = { semitones: -2, keepPitch: false, reverb: 0.3, size: 'hall' as const };

const play = (songId: string) =>
  store.setState((state) => ({ ...state, currentSongData: { ...state.currentSongData, songId } }));
const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  // The module talks to the core only inside the app.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    apiCalls.push({ path: `invoke.${command}`, args: [args] });
    if (command === 'song_sounds') return { fromfile: { semitones: 3, keepPitch: true, reverb: 0, size: 'room' } };
    if (command === 'song_sound_set') return { written: 1, unsupported: 0, failed: [] };
    return undefined;
  });
  localStorage.setItem('nemora.songSounds', JSON.stringify({ oldone: { name: 'Slowed', ...sound } }));
  songSound = await import('@renderer/other/songSound');
  await flushed();
});

beforeEach(() => {
  apiCalls.length = 0;
  storage.queue.setQueue({ ...store.state.localStorage.queue, queue: ['playing', 'next', 'later'], currentSongIndex: 0, queueType: 'songs' });
  play('playing');
  storage.preferences.setPreferences('isSoundInFileDisabled', false);
});

describe('Switch version and the file', () => {
  it('at a start takes what the library has and gives it what only this device had', () => {
    expect(songSound.songSoundStore.state.fromfile).toMatchObject({ semitones: 3, keepPitch: true, size: 'room' });
    expect(songSound.songSoundStore.state.oldone).toMatchObject({ semitones: -2 });
  });

  it('writes the file of a song the engine does not have open, at once', async () => {
    songSound.switchSongSound('later', sound);
    await flushed();
    expect(library()).toEqual(['later']);
    expect(files()).toEqual([['later', 'sound']]);
  });

  it('a row of a version or a variant is its song', async () => {
    songSound.switchSongSound('later:v3', sound);
    await flushed();
    expect(files()).toEqual([['later', 'sound']]);
  });

  it('waits for the playing song and the next, until the engine lets them go', async () => {
    songSound.switchSongSound('playing', sound);
    songSound.switchSongSound('next', sound);
    await flushed();
    expect(library()).toEqual(['playing', 'next']);
    expect(files()).toEqual([]);
    // The queue moves on by one: the old song is free; the new current one is not.
    storage.queue.setQueue({ ...store.state.localStorage.queue, currentSongIndex: 1 });
    play('next');
    await flushed();
    expect(files()).toEqual([['playing', 'sound']]);
    // And once more: the last one is free.
    storage.queue.setQueue({ ...store.state.localStorage.queue, currentSongIndex: 2 });
    play('later');
    await flushed();
    expect(files()).toEqual([['playing', 'sound'], ['next', 'sound']]);
  });

  it('back to the original removes the field, the last word winning while it waits', async () => {
    songSound.switchSongSound('playing', sound);
    songSound.switchSongSound('playing', null);
    await flushed();
    expect(files()).toEqual([]);
    storage.queue.setQueue({ ...store.state.localStorage.queue, queue: ['other'], currentSongIndex: 0 });
    play('other');
    await flushed();
    expect(files()).toEqual([['playing', 'removed']]);
    expect(songSound.songSoundStore.state.playing).toBeUndefined();
  });

  it('with the setting off, the library only', async () => {
    storage.preferences.setPreferences('isSoundInFileDisabled', true);
    songSound.switchSongSound('later', sound);
    songSound.switchSongSound('playing', sound);
    await flushed();
    expect(library()).toEqual(['later', 'playing']);
    expect(files()).toEqual([]);
    songSound.switchSongSound('playing', null);
    await flushed();
  });
});
