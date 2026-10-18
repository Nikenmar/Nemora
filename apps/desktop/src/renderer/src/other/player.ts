import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { store } from '../store';
import { equalizerBandHertzData } from './equalizerData';

/**
 * Slider value stays 0-100 (linear UI); apply a perceptual dB "audio taper" so
 * loudness changes evenly to the ear (like the Windows volume mixer) instead of
 * the near-inaudible top half a raw linear gain (value/100) produces.
 * Normalized exponential curve: continuous, maps 0->0 and 1->1, ~30 dB range
 * (50% ≈ -16 dB) — a perceptual taper that stays comfortably loud in the mid range.
 *
 * The engine applies the same curve (`nemora-audio::dsp::perceptual_gain`); this copy serves the
 * previews that still play through an audio element.
 */
export const getPerceptualGain = (volumeValue: number) => {
  const DYNAMIC_RANGE = Math.log(30); // ~30 dB of usable range
  const v = Math.min(Math.max(volumeValue / 100, 0), 1);
  return v <= 0 ? 0 : (Math.exp(DYNAMIC_RANGE * v) - 1) / (Math.exp(DYNAMIC_RANGE) - 1);
};

type EngineEvent =
  | { kind: 'loaded'; token: number; duration: number }
  | { kind: 'playing' | 'paused' | 'position' | 'seeked'; token: number; position: number }
  | { kind: 'ended'; token: number }
  | { kind: 'error'; token: number; message: string };

const BAND_ORDER = Object.keys(equalizerBandHertzData) as EqualizerBandFilters[];

/**
 * The player the view drives, with the surface of the audio element it used to be.
 *
 * Sound is rendered by Nemora's own engine (decode, the user's equalizer, volume and fades, WASAPI
 * shared), not by the webview: nothing in between resamples, normalises or lowers it. This class
 * only forwards what the view asks for and turns the engine's reports back into media events, so
 * the rest of the view needs no change.
 */
class AudioPlayer extends EventTarget {
  private token = 0;
  private source = '';
  private position = 0;
  /** When `position` was last known, for a smooth `currentTime` between reports. */
  private positionAt = performance.now();
  private length = Number.NaN;
  private isPaused = true;
  private hasEnded = false;
  private isSeeking = false;
  private rate = 1;
  private volumePercent = 100;
  private isMuted = false;
  private lastEqualizer = '';
  readyState = 0;
  error: { code: number; message: string } | null = null;
  unsubscribeFunc: () => void;

  constructor() {
    super();
    void listen<EngineEvent>('nemora://engine', ({ payload }) => this.onEngine(payload));
    this.unsubscribeFunc = store.subscribe(() => this.applyStore());
    this.applyStore();
  }

  unsubscribeFromStoreEvents() {
    this.unsubscribeFunc?.();
  }

  private fire(...names: string[]) {
    for (const name of names) this.dispatchEvent(new Event(name));
  }

  /**
   * Events the player raises itself go out as a later task, as a media element's do: code that sets
   * `src` and then `currentTime` must not see the seek of the new track inside its own call.
   */
  private fireLater(...names: string[]) {
    setTimeout(() => this.fire(...names), 0);
  }

  private setPosition(position: number) {
    this.position = position;
    this.positionAt = performance.now();
  }

  private onEngine(event: EngineEvent) {
    if (event.token !== this.token) return;
    switch (event.kind) {
      case 'loaded':
        this.length = event.duration;
        this.readyState = 4;
        this.fire('durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough');
        break;
      case 'playing':
        this.isPaused = false;
        this.hasEnded = false;
        this.setPosition(event.position);
        this.fire('play', 'playing');
        break;
      case 'paused':
        this.isPaused = true;
        this.setPosition(event.position);
        this.fire('pause');
        break;
      case 'position':
        if (!this.isSeeking) this.setPosition(event.position);
        this.fire('timeupdate');
        break;
      case 'seeked':
        this.isSeeking = false;
        this.setPosition(event.position);
        this.fire('seeked', 'timeupdate');
        break;
      case 'ended':
        this.isPaused = true;
        this.hasEnded = true;
        this.setPosition(Number.isFinite(this.length) ? this.length : this.position);
        this.fire('timeupdate', 'pause', 'ended');
        break;
      case 'error':
        this.error = { code: 4, message: event.message };
        this.fire('error');
        break;
    }
  }

  /** Volume, mute and equalizer follow the store, as they did for the audio element. */
  private applyStore() {
    const { localStorage, player } = store.state;
    const { value, isMuted } = player.volume;
    if (value !== this.volumePercent || isMuted !== this.isMuted) {
      this.volumePercent = value;
      this.isMuted = isMuted;
      void invoke('engine_volume', { percent: value, muted: isMuted }).catch(() => undefined);
      this.fireLater('volumechange');
    }
    const preset = localStorage.equalizerPreset;
    const gains = BAND_ORDER.map((band) => Number(preset?.[band] ?? 0));
    const key = gains.join(',');
    if (key !== this.lastEqualizer) {
      this.lastEqualizer = key;
      void invoke('engine_equalizer', { gains }).catch(() => undefined);
    }
    if (player.playbackRate !== this.rate) this.playbackRate = player.playbackRate;
  }

  get src(): string {
    return this.source;
  }

  set src(url: string) {
    this.token += 1;
    this.source = url;
    this.length = Number.NaN;
    this.readyState = 0;
    this.error = null;
    this.hasEnded = false;
    this.isPaused = true;
    this.setPosition(0);
    if (!url) {
      void invoke('engine_stop').catch(() => undefined);
      this.fireLater('emptied');
      return;
    }
    this.fireLater('emptied', 'loadstart');
    const token = this.token;
    void invoke('engine_load', { token, source: url, play: false, at: 0 }).catch((error: unknown) =>
      this.onEngine({ kind: 'error', token, message: String(error) })
    );
  }

  load() {
    const url = this.source;
    this.src = url;
  }

  play(): Promise<void> {
    if (!this.source) return Promise.reject(new DOMException('No source', 'NotSupportedError'));
    return invoke<void>('engine_play');
  }

  pause(): Promise<void> {
    return invoke<void>('engine_pause');
  }

  get currentTime(): number {
    if (this.isPaused || this.isSeeking) return this.position;
    const now = this.position + ((performance.now() - this.positionAt) / 1000) * this.rate;
    return Number.isFinite(this.length) ? Math.min(now, this.length) : now;
  }

  set currentTime(seconds: number) {
    if (!this.source || !Number.isFinite(seconds)) return;
    const target = Math.max(0, seconds);
    this.isSeeking = true;
    this.hasEnded = false;
    this.setPosition(target);
    this.fireLater('seeking');
    void invoke('engine_seek', { seconds: target }).catch(() => undefined);
  }

  get duration(): number {
    return this.length;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get ended(): boolean {
    return this.hasEnded;
  }

  get seeking(): boolean {
    return this.isSeeking;
  }

  /** The slider position, 0..1 (the engine applies the taper). */
  get volume(): number {
    return this.volumePercent / 100;
  }

  set volume(value: number) {
    this.volumePercent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
    void invoke('engine_volume', { percent: this.volumePercent, muted: this.isMuted }).catch(
      () => undefined
    );
  }

  get muted(): boolean {
    return this.isMuted;
  }

  set muted(value: boolean) {
    this.isMuted = value;
    void invoke('engine_volume', { percent: this.volumePercent, muted: value }).catch(
      () => undefined
    );
  }

  get playbackRate(): number {
    return this.rate;
  }

  /** Speed is not in the engine yet: the value is kept out, playback stays at 1x. */
  set playbackRate(rate: number) {
    if (rate !== 1) console.warn('Playback speed is not available yet; playing at 1x.');
    this.rate = 1;
    this.fireLater('ratechange');
  }
}

export default AudioPlayer;
