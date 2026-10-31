import { memo, useCallback, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import useAudioVisual, { follow } from '../hooks/useAudioVisual';

/**
 * Cover light: the cover's primary tone over the top of every page, its secondary one in the far
 * corner, as the Android player lights its own (other/coverLight.ts). With "Breathing cover light"
 * (PLAN/14 B1) its strength follows the track's loudness, smoothed so that a chorus is fuller and a
 * bridge quieter without ever flashing; only the layer's opacity changes, which the compositor does.
 */
const CoverGlow = memo(() => {
  const isBreathing = useStore(
    store,
    (state) =>
      !!state.localStorage.preferences.isBreathingCoverLight &&
      !state.localStorage.preferences.isCoverLightDisabled
  );
  const glowRef = useRef<HTMLDivElement>(null);
  const level = useRef(0.75);

  const onFrame = useCallback((frame: Float32Array, elapsed: number) => {
    // Loudness is 0 at -60 dBFS and 1 at 0 dBFS; music sits around 0.6..0.9.
    const goal = Math.min(1, Math.max(0, (frame[0] - 0.55) / 0.35));
    level.current = follow(level.current, goal, elapsed, 0.4, 0.7);
    if (glowRef.current) glowRef.current.style.opacity = (0.45 + 0.55 * level.current).toFixed(3);
  }, []);
  useAudioVisual(isBreathing, onFrame, glowRef, 15);

  return (
    <div
      ref={glowRef}
      aria-hidden
      className={`cover-glow pointer-events-none absolute inset-x-0 top-0 z-0 h-[24rem] ${
        isBreathing ? 'will-change-[opacity]' : '!opacity-100'
      }`}
      style={{
        backgroundImage: [
          'radial-gradient(ellipse 70% 100% at 18% -12%, color-mix(in srgb, var(--cover-glow) var(--cover-glow-strength), transparent), transparent 72%)',
          'radial-gradient(ellipse 45% 80% at 100% -20%, color-mix(in srgb, var(--cover-glow-2) calc(var(--cover-glow-strength) * 0.6), transparent), transparent 70%)'
        ].join(', ')
      }}
    />
  );
});

CoverGlow.displayName = 'CoverGlow';
export default CoverGlow;
