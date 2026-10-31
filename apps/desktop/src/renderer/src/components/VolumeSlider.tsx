import { useContext, useRef, type CSSProperties } from 'react';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { useStore } from '@tanstack/react-store';
import { store } from '../store';

type Props = {
  id: string;
  name: string;
  className?: string;
  onSeek?: (currentPosition: number) => void;
};

const VolumeSlider = (props: Props) => {
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const volume = useStore(store, (state) => state.player.volume.value);

  const { updateVolume } = useContext(AppUpdateContext);
  const { id, name, className, onSeek } = props;

  const volumeSliderRef = useRef<HTMLInputElement>(null);

  const volumeBarCssProperties: CSSProperties = {};
  volumeBarCssProperties['--volume-before-width'] = `${volume}%`;

  const changeVolume = (value: number) => {
    updateVolume(value);
    if (onSeek) onSeek(value);
  };

  return (
    <input
      type="range"
      id={id}
      name={name}
      className={`relative float-left m-0 h-6 w-full appearance-none bg-[transparent] p-0 outline-none outline-1 outline-offset-1 before:absolute before:left-0 before:top-1/2 before:h-1 before:w-[var(--volume-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:bg-ink before:transition-[background] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo ${className}`}
      min={0}
      max={100}
      value={volume}
      onChange={(e) => changeVolume(Number(e.target.value))}
      aria-label="Volume slider"
      style={volumeBarCssProperties}
      title={Math.round(volume).toString()}
      onWheel={(e) => {
        const scrollIncrement = preferences?.seekbarScrollInterval;
        const incrementValue = e.deltaY > 0 ? -scrollIncrement : scrollIncrement;
        let value = volume + incrementValue;

        if (value > 100) value = 100;
        if (value < 0) value = 0;
        changeVolume(value);
      }}
      ref={volumeSliderRef}
    />
  );
};

export default VolumeSlider;
