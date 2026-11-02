import { Store } from '@tanstack/react-store';
import { store } from '../store';
import { setPlayingVersion, versionStore } from './soundEffects';
import { soundTag } from './soundTag';

/**
 * Switch version: the song itself takes a version's sound, with no second row. Kept per song (its
 * id, not a row), so lists, sorts and "newest" do not change; "Back to original" removes it. While
 * the song plays, its sound is applied like a version's, and the panel edits it.
 */
export type SongSound = { name: string; semitones: number; keepPitch: boolean; reverb: number; size: Size };
type Size = 'room' | 'hall' | 'vast';

const KEY = 'nemora.songSounds';
/** The id the panel's "playing version" carries for a switched song (versions have positive ids). */
export const OWN_SOUND_ID = -1;

const load = (): Record<string, SongSound> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, SongSound>;
  } catch {
    return {};
  }
};

export const songSoundStore = new Store<Record<string, SongSound>>(load());

/** The song's own id from a row's view id (`<song>`, `<song>:<variant>` or `<song>:v<version>`). */
export const songOf = (viewId: string) => viewId.split(':')[0];

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(songSoundStore.state));
  } catch {
    /* not remembered */
  }
};

/** The pseudo-version the panel and the engine use for a switched song. */
export const ownVersionOf = (viewId: string): SongVersion | null => {
  const own = songSoundStore.state[songOf(viewId)];
  return own ? { id: OWN_SOUND_ID, songId: songOf(viewId), ...own } : null;
};

const reapplyIfPlaying = (viewId: string) => {
  const current = store.state.currentSongData;
  if (!current.songId || current.version || songOf(current.songId) !== songOf(viewId)) return;
  setPlayingVersion(ownVersionOf(viewId));
};

/** Gives the song this sound (named by its tag), or takes it away with `null`. */
export const switchSongSound = (viewId: string, sound: Omit<SongSound, 'name'> | null) => {
  const id = songOf(viewId);
  songSoundStore.setState((all) => {
    const next = { ...all };
    if (sound) next[id] = { ...sound, name: soundTag(sound) ?? 'Original' };
    else delete next[id];
    return next;
  });
  save();
  reapplyIfPlaying(viewId);
};

/** Keeps the panel's change to a switched song's sound (its "Save to version"). */
export const saveOwnSound = () => {
  const playing = versionStore.state;
  const current = store.state.currentSongData;
  if (!playing || playing.id !== OWN_SOUND_ID || !current.songId) return;
  const { semitones, keepPitch, reverb, size } = playing.sound;
  switchSongSound(current.songId, { semitones, keepPitch, reverb, size });
};
