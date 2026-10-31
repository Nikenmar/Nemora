import { type RefObject, useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { frameAt, getTrackVisuals, playbackPosition, type TrackVisuals } from '../other/trackVisuals';
import { isMotionReduced } from '../other/viewTransition';

/** Called with the frame for the player's position (loudness, then the bands, 0..1) and the seconds since the last call. */
export type VisualFrameHandler = (frame: Float32Array, elapsed: number) => void;


/**
 * Feeds `onFrame` the playing song's visual envelope (PLAN/14 B0) at the player's position. The loop
 * runs only while `enabled`, the song plays, the window is shown and `target` (when given) is on
 * screen; paused, it draws the frame for the paused position once. Off under reduced motion. `fps`
 * caps the calls: slow, smoothed effects need fewer than the envelope's 30.
 */
export default function useAudioVisual(
  enabled: boolean,
  onFrame: VisualFrameHandler,
  target?: RefObject<Element | null>,
  fps = 30
) {
  const songId = useStore(store, (state) => state.currentSongData.songId);
  const isPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const handler = useRef(onFrame);
  handler.current = onFrame;

  useEffect(() => {
    if (!enabled || !songId || isMotionReduced()) return undefined;
    let visuals: TrackVisuals | null = null;
    let frame: Float32Array | undefined;
    let raf = 0;
    let last = 0;
    let onScreen = true;
    let stopped = false;

    const draw = (now: number) => {
      if (!visuals) return;
      frame = frameAt(visuals, playbackPosition(), frame);
      handler.current(frame, last ? Math.min(0.25, (now - last) / 1000) : 0);
      last = now;
    };
    const tick = (now: number) => {
      raf = 0;
      if (now - last >= 1000 / fps - 2) draw(now);
      schedule();
    };
    const schedule = () => {
      if (stopped || raf || !visuals) return;
      if (!isPlaying || !onScreen || document.visibilityState !== 'visible') {
        last = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    getTrackVisuals(songId).then((loaded) => {
      if (stopped || !loaded) return;
      visuals = loaded;
      draw(performance.now());
      schedule();
    });

    const observer =
      target?.current &&
      new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        schedule();
      });
    if (observer && target?.current) observer.observe(target.current);
    const onVisibility = () => schedule();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, songId, isPlaying, target, fps]);
}

/** Moves `current` toward `goal`: quickly when rising (`attack` seconds), slowly when falling (`release`). */
export const follow = (current: number, goal: number, elapsed: number, attack: number, release: number) => {
  if (elapsed <= 0) return goal;
  const time = goal > current ? attack : release;
  return current + (goal - current) * (1 - Math.exp(-elapsed / time));
};

/**
 * A band's recent range, so its bar uses its whole height: the peak falls and the floor rises over a
 * few seconds, and a value is read as its place between them. Quiet tracks move as much as loud ones.
 */
export class Range {
  private floor = 1;
  private peak = 0;

  read(value: number, elapsed: number, settle = 3) {
    const pull = elapsed > 0 ? 1 - Math.exp(-elapsed / settle) : 0;
    this.peak = Math.max(value, this.peak - (this.peak - value) * pull);
    this.floor = Math.min(value, this.floor + (value - this.floor) * pull);
    const span = this.peak - this.floor;
    return span < 0.02 ? 0.5 : (value - this.floor) / span;
  }
}
