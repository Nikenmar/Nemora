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
  | {
      kind: 'playing' | 'paused' | 'position' | 'seeked';
      token: number;
      position: number;
    }
  | { kind: 'ended'; token: number; next: number | null }
  | { kind: 'error'; token: number; message: string };

const BAND_ORDER = Object.keys(equalizerBandHertzData) as EqualizerBandFilters[];

/** How long a queued track may play on its own before the view takes it over. */
const ADOPT_WITHIN_MS = 5000;

const withoutQuery = (url: string) => url.split(/[?#]/)[0];

/** The song the engine is told to continue with, and what it has said about it since. */
type QueuedTrack = {
  token: number;
  songId: string;
  /** The URL the view will set for it; unknown until the engine answers. */
  url: string | null;
  /** The engine has moved on to it: the previous track ended. */
  started: boolean;
  duration: number;
  position: number;
  positionAt: number;
  playing: boolean;
};

/**
 * The player the view drives, with the surface of the audio element it used to be.
 *
 * Sound is rendered by Nemora's own engine (decode, the user's equalizer, volume and fades, WASAPI
 * shared), not by the webview: nothing in between resamples, normalises or lowers it. This class
 * only forwards what the view asks for and turns the engine's reports back into media events, so
 * the rest of the view needs no change.
 *
 * Gapless: the player tells the engine which song follows in the queue. When the track ends the
 * engine is already playing that song, and the view's own move to it (setting `src`, or rewinding
 * for repeat-one) takes over the playing track instead of loading it again.
 */
class AudioPlayer extends EventTarget {
  private token = 0;
  private lastToken = 0;
  private queued: QueuedTrack | null = null;
  /** Token and song of the last queue request, so an unchanged queue is not sent again. */
  private queuedKey = '';
  private adoptTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by `play()`, so an adopted track the view does not start can be paused. */
  private playRequested = false;
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
    if (this.queued && event.token === this.queued.token) {
      this.onQueuedEngine(this.queued, event);
      return;
    }
    if (event.token !== this.token) return;
    switch (event.kind) {
      case 'loaded':
        this.length = event.duration;
        // An adopted track is ready already; only its length was still unknown.
        if (this.readyState === 4) this.fire('durationchange');
        else {
          this.readyState = 4;
          this.fire('durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough');
        }
        this.queueNext();
        break;
      case 'playing': {
        const wasPaused = this.isPaused;
        this.isPaused = false;
        this.hasEnded = false;
        this.setPosition(event.position);
        if (wasPaused) this.fire('play', 'playing');
        break;
      }
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
        // Marked before the view hears of the end: repeat-one rewinds inside its 'ended' handler.
        if (this.queued && event.next === this.queued.token) this.queuedStarted(this.queued);
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

  /** The engine moved on to the queued track, from the frame after the last one of this track. */
  private queuedStarted(queued: QueuedTrack) {
    queued.started = true;
    queued.playing = !this.isPaused;
    queued.position = 0;
    queued.positionAt = performance.now();
    clearTimeout(this.adoptTimer);
    // A view that does not move on (its queue changed at the very end) must not leave the engine
    // playing a song nobody chose.
    this.adoptTimer = setTimeout(() => {
      if (this.queued !== queued) return;
      this.queued = null;
      void invoke('engine_stop').catch(() => undefined);
    }, ADOPT_WITHIN_MS);
  }

  private onQueuedEngine(queued: QueuedTrack, event: EngineEvent) {
    switch (event.kind) {
      case 'loaded':
        queued.duration = event.duration;
        break;
      case 'playing':
      case 'paused':
      case 'position':
      case 'seeked':
        if (event.kind === 'playing') queued.playing = true;
        if (event.kind === 'paused') queued.playing = false;
        queued.position = event.position;
        queued.positionAt = performance.now();
        break;
      case 'ended':
      case 'error':
        this.queued = null;
        break;
    }
  }

  /** The song after the current one, as the view will choose it when this one ends. */
  private nextSongId(): string | null {
    if (!this.source || this.error) return null;
    const { localStorage, player, currentSongData } = store.state;
    if (player.isRepeating === 'repeat-1') return currentSongData.songId || null;
    const { queue, currentSongIndex } = localStorage.queue;
    if (typeof currentSongIndex !== 'number' || queue.length === 0) return null;
    let next: string | null = null;
    if (currentSongIndex < queue.length - 1) next = queue[currentSongIndex + 1];
    else if (player.isRepeating === 'repeat') next = queue[0];
    // The view toggles playback instead of reloading when asked for the song it already has.
    return next && next !== currentSongData.songId ? next : null;
  }

  /** Keeps the engine's queued track in step with the view's queue. */
  private queueNext() {
    // Between an end and the view's move on, the queue already names the song after the next.
    if (this.readyState < 4 || this.hasEnded || this.queued?.started) return;
    const songId = this.nextSongId();
    const key = `${this.token}|${songId ?? ''}`;
    if (key === this.queuedKey) return;
    this.queuedKey = key;
    if (!songId) {
      if (this.queued) {
        this.queued = null;
        void invoke('engine_queue_next', { token: 0, songId: null }).catch(() => undefined);
      }
      return;
    }
    this.lastToken += 1;
    const queued: QueuedTrack = {
      token: this.lastToken,
      songId,
      url: null,
      started: false,
      duration: Number.NaN,
      position: 0,
      positionAt: performance.now(),
      playing: false
    };
    this.queued = queued;
    invoke<string | null>('engine_queue_next', { token: queued.token, songId })
      .then((url) => {
        if (this.queued !== queued) return;
        if (url) queued.url = withoutQuery(url);
        else this.queued = null;
      })
      .catch(() => {
        if (this.queued === queued) this.queued = null;
      });
  }

  /**
   * Takes over the queued track the engine already plays, for the view's move to `url`.
   *
   * A rewind (repeat-one) keeps playing, as an element told to seek does. A new `src` goes through
   * the steps of a load, as the view expects: nothing is ready and nothing plays until `canplay`,
   * where the view asks for play. The engine keeps sounding meanwhile, so nothing is lost at the
   * join; a view that does not ask for play gets the track paused.
   */
  private adopt(url: string, rewind: boolean): boolean {
    const queued = this.queued;
    if (!queued?.started || !queued.url || queued.url !== withoutQuery(url)) return false;
    clearTimeout(this.adoptTimer);
    this.queued = null;
    this.token = queued.token;
    this.source = url;
    this.length = queued.duration;
    this.error = null;
    this.hasEnded = false;
    this.isSeeking = false;
    const elapsed = queued.playing ? (performance.now() - queued.positionAt) / 1000 : 0;
    this.setPosition(queued.position + elapsed);
    const ready = ['durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'];
    if (rewind) {
      this.readyState = 4;
      this.isPaused = !queued.playing;
      this.fireLater(
        'emptied',
        'loadstart',
        ...ready,
        ...(queued.playing ? ['play', 'playing'] : [])
      );
    } else {
      const token = this.token;
      this.readyState = 0;
      this.isPaused = true;
      this.fireLater('emptied', 'loadstart');
      setTimeout(() => {
        if (this.token !== token) return;
        this.readyState = 4;
        this.playRequested = false;
        this.fire(...ready);
        if (!this.playRequested && queued.playing) void this.pause().catch(() => undefined);
      }, 0);
    }
    setTimeout(() => this.queueNext(), 0);
    return true;
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
    this.queueNext();
  }

  get src(): string {
    return this.source;
  }

  set src(url: string) {
    if (url && this.adopt(url, false)) return;
    this.lastToken += 1;
    this.token = this.lastToken;
    this.queued = null;
    clearTimeout(this.adoptTimer);
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
    void invoke('engine_load', {
      token,
      source: url,
      play: false,
      at: 0
    }).catch((error: unknown) => this.onEngine({ kind: 'error', token, message: String(error) }));
  }

  load() {
    const url = this.source;
    this.src = url;
  }

  play(): Promise<void> {
    if (!this.source) return Promise.reject(new DOMException('No source', 'NotSupportedError'));
    this.playRequested = true;
    // An ended track has left the engine; playing it again starts it over, as an element does.
    if (this.hasEnded) return this.reload(0, true);
    return invoke<void>('engine_play');
  }

  private reload(at: number, play: boolean): Promise<void> {
    this.hasEnded = false;
    // A load replaces whatever the engine had queued or moved on to.
    this.queued = null;
    this.queuedKey = '';
    clearTimeout(this.adoptTimer);
    const token = this.token;
    return invoke<void>('engine_load', {
      token,
      source: this.source,
      play,
      at
    }).catch((error: unknown) => this.onEngine({ kind: 'error', token, message: String(error) }));
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
    // Repeat-one rewinds an ended track: the engine is already playing it again from the start.
    if (target < 1 && this.hasEnded && this.adopt(this.source, true)) return;
    this.isSeeking = true;
    this.setPosition(target);
    this.fireLater('seeking');
    if (this.hasEnded) {
      void this.reload(target, false).then(() => {
        this.isSeeking = false;
        this.fireLater('seeked', 'timeupdate');
      });
      return;
    }
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
    void invoke('engine_volume', {
      percent: this.volumePercent,
      muted: this.isMuted
    }).catch(() => undefined);
  }

  get muted(): boolean {
    return this.isMuted;
  }

  set muted(value: boolean) {
    this.isMuted = value;
    void invoke('engine_volume', {
      percent: this.volumePercent,
      muted: value
    }).catch(() => undefined);
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
