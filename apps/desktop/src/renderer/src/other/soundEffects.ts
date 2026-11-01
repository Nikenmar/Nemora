import { Store } from '@tanstack/react-store';
import { invoke } from '@tauri-apps/api/core';
import storage from '../utils/localStorage';
import { store } from '../store';
import { setBandShift } from './trackVisuals';

/**
 * Slowed & reverb (PLAN/18 D3): what the panel over the player bar sets, applied to the engine.
 *
 * The speed is in semitones. By default it is varispeed - the pitch goes with the speed, as a
 * turntable or FL Studio's resample does it; with **Keep pitch** the same slider drives the
 * pitch-preserving time-stretch instead (the old playback-speed setting, `playback.playbackRate`).
 * The reverb is added to the dry signal. Kept in its own small key, applied at start-up.
 */

export type Unit = 'st' | 'x' | '%';
export type Size = 'room' | 'hall' | 'vast';
export type Sound = { semitones: number; keepPitch: boolean; reverb: number; size: Size; unit: Unit };

export const ORIGINAL: Sound = { semitones: 0, keepPitch: false, reverb: 0, size: 'hall', unit: 'st' };

/** The presets: the user's three slowed ones (2026-11-01), the fast side mirrored. */
export const PRESETS = [
  { id: 'ultraSlowed', semitones: -6 },
  { id: 'superSlowed', semitones: -4 },
  { id: 'slowed', semitones: -2 },
  { id: 'original', semitones: 0 },
  { id: 'spedUp', semitones: 2 },
  { id: 'nightcore', semitones: 4 }
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];

/** The "+ Reverb" chip: a slowed + reverb setting. */
export const REVERB_CHIP = { reverb: 0.35, size: 'hall' as Size };

export const RANGE = 12;
const KEY = 'nemora.sound';

export const factorOf = (semitones: number) => 2 ** (semitones / 12);
export const semitonesOf = (factor: number) => 12 * Math.log2(factor);

const load = (): Sound => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sound> | null;
    if (saved) return { ...ORIGINAL, ...saved };
  } catch {
    // A broken key starts from the original sound.
  }
  // The old playback-speed setting, if the user had one, becomes Keep pitch at that speed.
  const rate = store.state.localStorage.playback.playbackRate || 1;
  return rate !== 1 ? { ...ORIGINAL, keepPitch: true, semitones: semitonesOf(rate) } : ORIGINAL;
};

export const soundStore = new Store<Sound>(ORIGINAL);
/** Whether the panel is open (the player bar's button, or the "…" menu). */
export const soundPanelStore = new Store<boolean>(false);

type VarispeedPlayer = { varispeed: number; setReverb: (amount: number, size: Size) => void };
let target: VarispeedPlayer | null = null;

/** The version playing now (PLAN/18 D6): its sound is heard instead of the panel's, and the panel
 * edits it (Save to version keeps the change). */
export type PlayingVersion = { id: number; name: string; sound: Sound; isChanged: boolean };
export const versionStore = new Store<PlayingVersion | null>(null);

const apply = () => {
  const sound = versionStore.state?.sound ?? soundStore.state;
  const factor = factorOf(sound.semitones);
  if (target) {
    target.varispeed = sound.keepPitch ? 1 : factor;
    target.setReverb(sound.reverb, sound.size);
  }
  const rate = sound.keepPitch ? factor : 1;
  if ((store.state.localStorage.playback.playbackRate || 1) !== rate) storage.setItem('playback', 'playbackRate', rate);
  setBandShift(sound.keepPitch ? 1 : factor);
};

/** App hands over its player once, at start-up; the saved sound is applied from then on. */
export const registerSoundPlayer = (player: VarispeedPlayer) => {
  target = player;
  soundStore.setState(() => load());
  apply();
  // The old speed setting in Settings still writes `playbackRate`: the panel follows it as Keep
  // pitch at that speed, so the two never disagree.
  let lastRate = store.state.localStorage.playback.playbackRate || 1;
  store.subscribe(() => {
    const rate = store.state.localStorage.playback.playbackRate || 1;
    if (rate === lastRate) return;
    lastRate = rate;
    const sound = soundStore.state;
    const expected = sound.keepPitch ? factorOf(sound.semitones) : 1;
    if (Math.abs(rate - expected) < 1e-9) return;
    setSound({ keepPitch: rate !== 1 || sound.keepPitch, semitones: rate !== 1 ? semitonesOf(rate) : sound.keepPitch ? 0 : sound.semitones });
  });
};

export const setSound = (change: Partial<Sound>) => {
  const playing = versionStore.state;
  if (playing && !('unit' in change && Object.keys(change).length === 1)) {
    versionStore.setState(() => ({ ...playing, sound: { ...playing.sound, ...change }, isChanged: true }));
    apply();
    return;
  }
  soundStore.setState((state) => ({ ...state, ...change }));
  try {
    localStorage.setItem(KEY, JSON.stringify(soundStore.state));
  } catch {
    // Only the next start loses it.
  }
  apply();
};

/** The sound of a version (PLAN/18 D6). */
export const soundOfVersion = (v: SongVersion): Sound => ({
  semitones: v.semitones,
  keepPitch: v.keepPitch,
  reverb: v.reverb,
  size: v.size,
  unit: soundStore.state.unit
});

/** A version's own sound while it plays; `null` gives the panel's back. */
export const setPlayingVersion = (version: SongVersion | null) => {
  versionStore.setState(() =>
    version ? { id: version.id, name: version.name, sound: soundOfVersion(version), isChanged: false } : null
  );
  apply();
};

/** Keeps the panel's change to the version playing. */
export const saveVersionSound = async () => {
  const playing = versionStore.state;
  if (!playing) return;
  const { semitones, keepPitch, reverb, size } = playing.sound;
  await window.api.tierlistsData.versionUpdate(playing.id, { name: playing.name, semitones, keepPitch, reverb, size });
  versionStore.setState(() => ({ ...playing, isChanged: false }));
};

export const isEffectOn = (sound: Sound) => Math.abs(sound.semitones) > 1e-9 || sound.reverb > 0;

/** The preset a sound is, if any. */
export const presetOf = (sound: Sound): PresetId | null =>
  PRESETS.find((p) => Math.abs(p.semitones - sound.semitones) < 1e-6)?.id ?? null;

/** How the speed reads in a unit. */
export const speedLabel = (semitones: number, unit: Unit) => {
  const factor = factorOf(semitones);
  if (unit === 'x') return `${factor.toFixed(3)}x`;
  if (unit === '%') return `${factor >= 1 ? '+' : ''}${((factor - 1) * 100).toFixed(1)} %`;
  const rounded = Math.round(semitones * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} st`;
};

/** The effect's name as listeners know it: a preset's name (or the speed), "+ Reverb" with it.
 * `name` translates a preset id. Empty when nothing is on. */
export const effectName = (sound: Sound, name: (id: PresetId) => string) => {
  if (!isEffectOn(sound)) return '';
  const preset = presetOf(sound);
  const speed = preset && preset !== 'original' ? name(preset) : Math.abs(sound.semitones) > 1e-9 ? speedLabel(sound.semitones, 'st') : '';
  const reverb = sound.reverb > 0 ? 'Reverb' : '';
  return speed && reverb ? `${speed} + ${reverb}` : speed || reverb;
};

/** Whether the engine clipped (a sample past 0 dBFS) since the last ask. */
export const takeClipped = () => invoke<boolean>('engine_clipped').catch(() => false);
