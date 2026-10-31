import { memo } from 'react';
import { cn } from './cn';

/** Each bar its own period and phase, so the four never line up into one pulse. */
const BARS = [
  { duration: '0.92s', delay: '-0.35s' },
  { duration: '0.71s', delay: '-0.6s' },
  { duration: '1.08s', delay: '-0.15s' },
  { duration: '0.83s', delay: '-0.5s' }
];

/**
 * The "playing now" mark in a song row: four bars bouncing in the text colour while the song plays,
 * frozen where they are while it is paused (keyframes `eqBar` in styles.css; still under reduced
 * motion, like every animation).
 */
const EqualizerBars = memo(({ isPlaying, className }: { isPlaying: boolean; className?: string }) => (
  <span className={cn('inline-flex h-3 w-3.5 shrink-0 items-end justify-between', className)} aria-hidden>
    {BARS.map((bar) => (
      <span
        key={bar.duration}
        className="h-full w-[2px] origin-bottom rounded-full bg-current"
        style={{
          animation: `eqBar ${bar.duration} ease-in-out ${bar.delay} infinite`,
          animationPlayState: isPlaying ? 'running' : 'paused'
        }}
      />
    ))}
  </span>
));

EqualizerBars.displayName = 'EqualizerBars';
export default EqualizerBars;
