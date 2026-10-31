import { useState } from 'react';
import { isMotionReduced } from '../../other/viewTransition';
import calculateTime from '../../utils/calculateTime';
import SeekBarSlider from '../SeekBarSlider';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const SeekBarContainer = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const [songPos, setSongPos] = useState(0);
  // The time under the pointer while it is over the bar (PLAN/14 A17).
  const [hover, setHover] = useState<{ x: number; seconds: number } | null>(null);
  const hoverTime = hover ? calculateTime(hover.seconds) : null;

  const currentSongPosition = calculateTime(songPos);
  const songDuration = preferences?.showSongRemainingTime
    ? currentSongData.duration - Math.floor(songPos) >= 0
      ? calculateTime(currentSongData.duration - Math.floor(songPos))
      : calculateTime(0)
    : calculateTime(currentSongData.duration);

  return (
    <div className="seekbar-and-song-durations-container flex w-full max-w-[36rem] flex-row items-center gap-2.5 text-micro tabular-nums text-ink-dim">
      <div className="current-song-duration w-10 shrink-0 text-right">
        {currentSongPosition.minutes}:{currentSongPosition.seconds}
      </div>
      <div
        className="seek-bar relative flex h-fit min-w-0 flex-1 items-center"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const fraction = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
          setHover({ x: fraction * box.width, seconds: fraction * (currentSongData.duration || 0) });
        }}
        onPointerLeave={() => setHover(null)}
      >
        {hover && hoverTime && (
          <span
            aria-hidden
            className={`pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md border border-glass-border bg-surface-3 px-1.5 py-0.5 text-micro tabular-nums text-ink shadow-float ${
              isMotionReduced() ? '' : 'animate-[tooltipIn_120ms_var(--ease-out)]'
            }`}
            style={{ left: hover.x }}
          >
            {hoverTime.minutes}:{hoverTime.seconds}
          </span>
        )}
        <SeekBarSlider
          id="seek-bar-slider"
          name="seek-bar-slider"
          onSeek={(currentPosition) => setSongPos(currentPosition)}
        />
      </div>
      <div className="full-song-duration w-10 shrink-0 text-left">
        {preferences?.showSongRemainingTime ? '-' : ''}
        {songDuration.minutes}:{songDuration.seconds}
      </div>
    </div>
  );
};

export default SeekBarContainer;
