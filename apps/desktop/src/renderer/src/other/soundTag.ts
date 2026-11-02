import { useStore } from '@tanstack/react-store';
import { soundStore, versionStore } from './soundEffects';

/**
 * The tag beside a title that says how it sounds (the user's scale, 2026-11-02): a name for every
 * speed, whatever way it was set (a preset, the slider, a version), and "+ Reverb" when there is
 * reverb. Shown apart from the title, never written into it.
 */
const SPED_UP: [number, string][] = [
  [12, 'Omega Sped Up'],
  [10, 'Absolute Sped Up'],
  [8, 'Extreme Sped Up'],
  [6, 'Ultra Nightcore'],
  [4, 'Nightcore'],
  [2, 'Sped Up'],
  [1, 'Light Sped Up']
];
const SLOWED: [number, string][] = [
  [12, 'Omega Slowed'],
  [10, 'Absolute Slowed'],
  [8, 'Extreme Slowed'],
  [6, 'Ultra Slowed'],
  [4, 'Super Slowed'],
  [2, 'Slowed'],
  [1, 'Light Slowed']
];

/**
 * The speed's name: the step it is nearest at or past (half a tone short counts: -1.5 is Slowed,
 * -3 still Slowed, -3.5 Super Slowed); nothing within half a tone of the original.
 */
export const speedTag = (semitones: number): string | null => {
  const amount = Math.abs(semitones);
  if (amount < 0.5) return null;
  const steps = semitones > 0 ? SPED_UP : SLOWED;
  return steps.find(([step]) => amount + 0.5 >= step)?.[1] ?? null;
};

export const soundTag = (sound: { semitones: number; reverb: number }): string | null => {
  const speed = speedTag(sound.semitones);
  const reverb = sound.reverb > 0.001;
  if (speed && reverb) return `${speed} + Reverb`;
  return speed ?? (reverb ? 'Reverb' : null);
};

/** Names a version gets by itself (from the scale, with or without reverb, and the old presets). */
const AUTOMATIC = new Set(
  [...SPED_UP, ...SLOWED, [0, 'Original'] as [number, string]].flatMap(([, name]) => [name, `${name} + Reverb`]).concat('Reverb')
);

/** A version's tag: its sound's, unless the user gave it a name of their own. */
export const versionTag = (version: { name: string; semitones: number; reverb: number }): string | null =>
  AUTOMATIC.has(version.name.trim()) ? (soundTag(version) ?? version.name) : version.name;

/** The tag of what plays now: the playing version's (with any unsaved change), else the panel's sound. */
export const usePlayingTag = (): string | null => {
  const version = useStore(versionStore, (v) => v);
  const sound = useStore(soundStore, (s) => s);
  if (version) {
    if (!version.isChanged && !AUTOMATIC.has(version.name.trim())) return version.name;
    return soundTag(version.sound);
  }
  return soundTag(sound);
};

/** The same outside React (the OBS widget, Discord, the window title). */
export const playingTag = (): string | null => {
  const version = versionStore.state;
  if (version) {
    if (!version.isChanged && !AUTOMATIC.has(version.name.trim())) return version.name;
    return soundTag(version.sound);
  }
  return soundTag(soundStore.state);
};
