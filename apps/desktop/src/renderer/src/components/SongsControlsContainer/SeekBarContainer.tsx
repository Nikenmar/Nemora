import { useState } from 'react';
import calculateTime from '../../utils/calculateTime';
import SeekBarSlider from '../SeekBarSlider';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const SeekBarContainer = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const [songPos, setSongPos] = useState(0);

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
      <div className="seek-bar relative flex h-fit min-w-0 flex-1 items-center">
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
