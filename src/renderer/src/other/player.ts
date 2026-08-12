import { store } from '../store';
import { equalizerBandHertzData } from './equalizerData';

const AUDIO_FADE_INTERVAL = 50;
const AUDIO_FADE_DURATION = 250;

/**
 * Slider value stays 0-100 (linear UI); apply a perceptual dB "audio taper" so
 * loudness changes evenly to the ear (like the Windows volume mixer) instead of
 * the near-inaudible top half a raw linear gain (value/100) produces.
 * Normalized exponential curve: continuous, maps 0->0 and 1->1, ~30 dB range
 * (50% ≈ -16 dB) — a perceptual taper that stays comfortably loud in the mid range.
 */
export const getPerceptualGain = (volumeValue: number) => {
  const DYNAMIC_RANGE = Math.log(30); // ~30 dB of usable range
  const v = Math.min(Math.max(volumeValue / 100, 0), 1);
  return v <= 0 ? 0 : (Math.exp(DYNAMIC_RANGE * v) - 1) / (Math.exp(DYNAMIC_RANGE) - 1);
};

/** True when every band sits at 0 dB, which is the shipped default. */
const isFlatPreset = (preset: LocalStorage['equalizerPreset'] | undefined): boolean =>
  !preset || Object.values(preset).every((gain) => gain === 0);

class AudioPlayer extends Audio {
  currentVolume: number;

  /**
   * The equalizer graph, built ON DEMAND.
   *
   * It used to be built in the constructor, so every track played through ten
   * biquad filters whether or not the user had ever touched the equalizer.
   * That is per-sample work that never stops: measured at ~10x the CPU of the
   * Electron build during playback, identical for FLAC and MP3, and unchanged
   * with the window minimised, which is what ruled out decoding and rendering
   * as the cause.
   *
   * `createMediaElementSource` is one-way: once called, the element can never
   * go back to the browser's own output path. So the graph is not created at
   * all while the preset is flat, and a preset that returns to flat bypasses
   * the filters instead of leaving them in the path at 0 dB.
   */
  private audioContext?: AudioContext;
  private equalizerSource?: MediaElementAudioSourceNode;
  private equalizerBands: Map<EqualizerBandFilters, BiquadFilterNode>;
  private equalizerEngaged = false;

  fadeOutIntervalId: ReturnType<typeof setTimeout> | undefined;
  fadeInIntervalId: ReturnType<typeof setTimeout> | undefined;

  unsubscribeFunc: () => void;

  constructor() {
    super();

    super.preload = 'auto';
    super.defaultPlaybackRate = 1.0;

    // The equalizer routes this element through createMediaElementSource. Under
    // Tauri the page is http://tauri.localhost while audio is served from
    // http://nemora.localhost, so the media is CROSS-ORIGIN: without opting into
    // CORS, Chromium feeds the graph silence - playing "successfully" with no
    // sound and no entry in the Windows mixer.
    //
    // Guarded so the element still works in a plain browser during testing,
    // where nothing serves the scheme and asking for CORS would fail the load.
    if ('__TAURI_INTERNALS__' in window) super.crossOrigin = 'anonymous';

    this.equalizerBands = new Map();
    this.currentVolume = super.volume;

    // No AudioContext and no graph here on purpose. Both are created the first
    // time a non-flat preset arrives; see updateEqualizerPreset.
    this.unsubscribeFunc = this.subscribeToStoreEvents();
  }

  unsubscribeFromStoreEvents() {
    if (this.unsubscribeFunc) this.unsubscribeFunc();
  }

  private fadeOutAudio(): Promise<void> {
    return new Promise((resolve) => {
      if (this.fadeInIntervalId) clearInterval(this.fadeInIntervalId);
      if (this.fadeOutIntervalId) clearInterval(this.fadeOutIntervalId);

      this.fadeOutIntervalId = setInterval(() => {
        // console.log(super.volume);
        if (super.volume > 0) {
          const rate = this.currentVolume / (100 * (AUDIO_FADE_DURATION / AUDIO_FADE_INTERVAL));
          if (super.volume - rate <= 0) super.volume = 0;
          else super.volume -= rate;
        } else {
          super.pause();
          if (this.fadeOutIntervalId) clearInterval(this.fadeOutIntervalId);
          resolve(undefined);
        }
      }, AUDIO_FADE_INTERVAL);
    });
  }

  private fadeInAudio(): Promise<void> {
    return new Promise((resolve) => {
      if (this.fadeInIntervalId) clearInterval(this.fadeInIntervalId);
      if (this.fadeOutIntervalId) clearInterval(this.fadeOutIntervalId);

      this.fadeInIntervalId = setInterval(() => {
        // console.log(super.volume);
        if (super.volume < this.currentVolume / 100) {
          const rate =
            (this.currentVolume / 100 / AUDIO_FADE_INTERVAL) *
            (AUDIO_FADE_DURATION / AUDIO_FADE_INTERVAL);
          if (super.volume + rate >= this.currentVolume / 100)
            super.volume = this.currentVolume / 100;
          else super.volume += rate;
        } else if (this.fadeInIntervalId) {
          clearInterval(this.fadeInIntervalId);
          resolve(undefined);
        }
      }, AUDIO_FADE_INTERVAL);
    });
  }

  /** Creates the context, the bands and the element source. Runs once. */
  private buildEqualizerGraph(): void {
    if (this.audioContext) return;

    const context = new window.AudioContext();
    this.audioContext = context;

    for (const [filterName, hertzValue] of Object.entries(equalizerBandHertzData)) {
      const band = context.createBiquadFilter();
      band.type = 'peaking';
      band.frequency.value = hertzValue;
      band.Q.value = 1;
      band.gain.value = 0;
      this.equalizerBands.set(filterName as EqualizerBandFilters, band);
    }

    this.equalizerSource = context.createMediaElementSource(this);
    // The context starts suspended under the autoplay policy. This only ever
    // runs off a user changing the equalizer, so a gesture has happened.
    void context.resume().catch(() => undefined);
  }

  /** source -> band -> band -> ... -> destination */
  private engageEqualizer(): void {
    this.buildEqualizerGraph();
    const context = this.audioContext;
    const source = this.equalizerSource;
    if (!context || !source || this.equalizerEngaged) return;

    source.disconnect();
    let node: AudioNode = source;
    for (const band of this.equalizerBands.values()) {
      node.connect(band);
      node = band;
    }
    node.connect(context.destination);
    this.equalizerEngaged = true;
  }

  /**
   * source -> destination, with the bands out of the path.
   *
   * Leaving ten filters connected at 0 dB would keep costing per-sample work
   * to do nothing, so a preset reset to flat really does remove them.
   */
  private bypassEqualizer(): void {
    const context = this.audioContext;
    const source = this.equalizerSource;
    if (!context || !source || !this.equalizerEngaged) return;

    source.disconnect();
    for (const band of this.equalizerBands.values()) band.disconnect();
    source.connect(context.destination);
    this.equalizerEngaged = false;
  }

  // ? PLAYER RELATED STORE UPDATES HANDLING
  private updateEqualizerPreset(equalizerPreset: LocalStorage['equalizerPreset']) {
    if (isFlatPreset(equalizerPreset)) {
      // Never built means never pay: a flat preset leaves the element on the
      // browser's own output path, which is the whole point of this.
      this.bypassEqualizer();
      return;
    }

    this.engageEqualizer();
    for (const [filterName, gainValue] of Object.entries(equalizerPreset)) {
      const band = this.equalizerBands.get(filterName as EqualizerBandFilters);
      if (band && band.gain.value !== gainValue) band.gain.value = gainValue;
    }
  }

  private updatePlayerVolume(volume: PlayerVolume) {
    this.volume = getPerceptualGain(volume.value);
    this.muted = volume.isMuted;
  }

  private updatePlaybackRate(playbackRate: number) {
    if (this.playbackRate !== playbackRate) this.playbackRate = playbackRate;
  }

  private subscribeToStoreEvents() {
    const unsubscribeFunction = store.subscribe(() => {
      if (store) {
        const { localStorage, player } = store.state;

        this.updateEqualizerPreset(localStorage.equalizerPreset);
        this.updatePlayerVolume(player.volume);
        this.updatePlaybackRate(player.playbackRate);
      }
    });

    return unsubscribeFunction;
  }

  play() {
    super.play();
    return this.fadeInAudio();
  }
  pause() {
    return this.fadeOutAudio();
  }

  get volume(): number {
    return this.currentVolume / 100;
  }

  set volume(volume: number) {
    if (this.fadeInIntervalId) clearInterval(this.fadeInIntervalId);
    if (this.fadeOutIntervalId) clearInterval(this.fadeOutIntervalId);

    this.currentVolume = volume * 100;
    super.volume = volume;
  }
}

export default AudioPlayer;
