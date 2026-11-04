import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { apiCalls } from './setup';
import { store } from '@renderer/store';
import storage from '@renderer/utils/localStorage';

/**
 * Switch version's sound and the song's file: both hear at once, the song playing too, one file at a
 * time with the last press winning; a file that refuses is tried again at the next song change; the
 * setting keeps everything out of the files.
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
/** While set, a file write does not finish: the next ones have to wait for it. */
let held: Promise<void> | null = null;
/** While on, the files refuse. */
let refuse = false;

beforeAll(async () => {
  // The module talks to the core only inside the app.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    apiCalls.push({ path: `invoke.${command}`, args: [args] });
    if (command === 'song_sounds') return { fromfile: { semitones: 3, keepPitch: true, reverb: 0, size: 'room' } };
    if (command === 'song_sound_set') {
      const { writeFile } = args as { writeFile: boolean };
      if (writeFile && held) await held;
      return { written: 1, unsupported: 0, failed: writeFile && refuse ? ['in use'] : [] };
    }
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

  it('writes the file at once, for any song', async () => {
    songSound.switchSongSound('later', sound);
    await flushed();
    expect(library()).toEqual(['later']);
    expect(files()).toEqual([['later', 'sound']]);
  });

  it('writes the file of the song playing and of the next at once too', async () => {
    songSound.switchSongSound('playing', sound);
    await flushed();
    songSound.switchSongSound('next', sound);
    await flushed();
    expect(library()).toEqual(['playing', 'next']);
    expect(files()).toEqual([['playing', 'sound'], ['next', 'sound']]);
  });

  it('a row of a version or a variant is its song', async () => {
    songSound.switchSongSound('later:v3', sound);
    await flushed();
    expect(files()).toEqual([['later', 'sound']]);
  });

  it('back to the original removes the field', async () => {
    songSound.switchSongSound('playing', null);
    await flushed();
    expect(files()).toEqual([['playing', 'removed']]);
    expect(songSound.songSoundStore.state.playing).toBeUndefined();
  });

  it('one file at a time: quick presses leave the last one, and the library hears each', async () => {
    let free = () => {};
    held = new Promise((resolve) => (free = resolve));
    songSound.switchSongSound('later', sound);
    await flushed();
    songSound.switchSongSound('later', { ...sound, semitones: 1 });
    songSound.switchSongSound('later', { ...sound, semitones: 2 });
    songSound.switchSongSound('later', null);
    await flushed();
    expect(library()).toEqual(['later', 'later', 'later', 'later']);
    expect(files()).toEqual([['later', 'sound']]);
    held = null;
    free();
    await flushed();
    await flushed();
    expect(files()).toEqual([['later', 'sound'], ['later', 'removed']]);
  });

  it('a file that refuses is tried again at the next song change, with the last word', async () => {
    refuse = true;
    songSound.switchSongSound('later', sound);
    await flushed();
    expect(files()).toEqual([['later', 'sound']]);
    refuse = false;
    play('next');
    await flushed();
    expect(files()).toEqual([['later', 'sound'], ['later', 'sound']]);
    // Tried once: nothing is left to try.
    play('playing');
    await flushed();
    expect(files()).toHaveLength(2);
  });

  it('a newer press replaces what a refused file was waiting to say', async () => {
    refuse = true;
    songSound.switchSongSound('later', sound);
    await flushed();
    refuse = false;
    songSound.switchSongSound('later', null);
    await flushed();
    expect(files()).toEqual([['later', 'sound'], ['later', 'removed']]);
    play('next');
    await flushed();
    expect(files()).toHaveLength(2);
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
