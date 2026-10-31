import { memo, useCallback, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { cn } from './cn';
import useAudioVisual, { follow, Range } from '../../hooks/useAudioVisual';

/** Each bar its own period and phase, so the four never line up into one pulse. */
const BARS = [
  { duration: '0.92s', delay: '-0.35s' },
  { duration: '0.71s', delay: '-0.6s' },
  { duration: '1.08s', delay: '-0.15s' },
  { duration: '0.83s', delay: '-0.5s' }
];

/** The envelope's 12 bands read as four: lows, low mids, high mids, highs. */
const GROUPS = [
  [0, 3],
  [3, 6],
  [6, 9],
  [9, 12]
];

/**
 * The "playing now" mark in a song row: four bars bouncing in the text colour while the song plays,
 * frozen where they are while it is paused (keyframes `eqBar` in styles.css; still under reduced
 * motion, like every animation). With "Live equalizer in song rows" (PLAN/14 B2) the bars follow the
 * song's own four bands instead, each scaled to its recent range.
 */
const EqualizerBars = memo(({ isPlaying, className }: { isPlaying: boolean; className?: string }) => {
  const isLive = useStore(store, (state) => !!state.localStorage.preferences.isLiveRowEqualizer);
  const rootRef = useRef<HTMLSpanElement>(null);
  const levels = useRef([0.3, 0.3, 0.3, 0.3]);
  const ranges = useRef(GROUPS.map(() => new Range()));

  const onFrame = useCallback((frame: Float32Array, elapsed: number) => {
    const bars = rootRef.current?.children;
    if (!bars) return;
    GROUPS.forEach(([from, to], i) => {
      let sum = 0;
      for (let b = from; b < to; b += 1) sum += frame[1 + b];
      const goal = Math.max(0.15, ranges.current[i].read(sum / (to - from), elapsed));
      levels.current[i] = follow(levels.current[i], goal, elapsed, 0.04, 0.16);
      (bars[i] as HTMLElement).style.transform = `scaleY(${levels.current[i].toFixed(3)})`;
    });
  }, []);
  useAudioVisual(isLive, onFrame, rootRef);

  return (
    <span
      ref={rootRef}
      className={cn('inline-flex h-3 w-3.5 shrink-0 items-end justify-between', className)}
      aria-hidden
    >
      {BARS.map((bar) => (
        <span
          key={bar.duration}
          className="h-full w-[2px] origin-bottom rounded-full bg-current"
          style={
            isLive
              ? { transform: 'scaleY(0.3)' }
              : {
                  animation: `eqBar ${bar.duration} ease-in-out ${bar.delay} infinite`,
                  animationPlayState: isPlaying ? 'running' : 'paused'
                }
          }
        />
      ))}
    </span>
  );
});

EqualizerBars.displayName = 'EqualizerBars';
export default EqualizerBars;
