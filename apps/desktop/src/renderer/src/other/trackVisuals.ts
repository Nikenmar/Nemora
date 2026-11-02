import { ipc } from '@platform/ipc';

/** A track's visual envelope (PLAN/14 B0): per 1/30 s the loudness and 12 bands, 0..255 each. */
export type TrackVisuals = {
  fps: number;
  bands: number;
  frames: number;
  /** Frame `i` starts at `i * (1 + bands)`: loudness, then the bands low to high. */
  data: Uint8Array;
};

const HEADER = 4;
const kept = new Map<string, Promise<TrackVisuals | null>>();

const parse = (buffer: ArrayBuffer): TrackVisuals | null => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length <= HEADER || bytes[0] !== 1) return null;
  const fps = bytes[1];
  const bands = bytes[2];
  const data = bytes.subarray(HEADER);
  return { fps, bands, frames: Math.floor(data.length / (1 + bands)), data };
};

/** The envelope of `songId`, analysed on first request; null when it cannot be decoded. */
export const getTrackVisuals = (songId: string): Promise<TrackVisuals | null> => {
  let pending = kept.get(songId);
  if (!pending) {
    pending = ipc('track_visuals', { songId })
      .then(parse)
      .catch(() => null);
    kept.set(songId, pending);
    if (kept.size > 8) kept.delete(kept.keys().next().value as string);
  }
  return pending;
};

/** Bands per octave-ish step: the 12 bands span 40 Hz to 16 kHz evenly in log frequency. */
const BAND_STEP = Math.log(16_000 / 40) / 12;
/** How many bands the sound has moved (varispeed moves every frequency by its factor, PLAN/18). */
let bandShift = 0;

/** Varispeed's factor, so the bars show the frequencies heard rather than the file's. */
export const setBandShift = (factor: number) => {
  bandShift = Math.log(factor) / BAND_STEP;
};

/** The frame for `seconds` into the track: loudness and bands, 0..1. */
export const frameAt = (visuals: TrackVisuals, seconds: number, out?: Float32Array): Float32Array => {
  const record = 1 + visuals.bands;
  const frame = out ?? new Float32Array(record);
  const index = Math.min(visuals.frames - 1, Math.max(0, Math.floor(seconds * visuals.fps)));
  const base = index * record;
  frame[0] = visuals.data[base] / 255;
  for (let b = 0; b < visuals.bands; b += 1) {
    if (bandShift === 0) {
      frame[1 + b] = visuals.data[base + 1 + b] / 255;
      continue;
    }
    // Band b now holds what the file had at b - shift (slowed: the sound moved down).
    const from = b - bandShift;
    const i = Math.floor(from);
    const t = from - i;
    const at = (k: number) => (k < 0 || k >= visuals.bands ? 0 : visuals.data[base + 1 + k] / 255);
    frame[1 + b] = at(i) * (1 - t) + at(i + 1) * t;
  }
  return frame;
};

let clock: () => number = () => 0;

/** App gives the player's position here; the visuals read it by frame, so they stay in sync. */
export const setPlaybackClock = (read: () => number) => {
  clock = read;
};

export const playbackPosition = () => clock();
