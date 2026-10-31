import {
  type CSSProperties,
  type ChangeEvent,
  type WheelEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';
import { cn } from './ui/cn';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import debounce from '../utils/debounce';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

type Props = {
  id: string;
  name: string;
  className?: string;
  onSeek?: (currentPosition: number) => void;
};

const SeekBarSlider = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { updateSongPosition } = useContext(AppUpdateContext);

  const { id, name, className, onSeek } = props;

  const [songPos, setSongPos] = useState(0);
  const isMouseDownRef = useRef(false);
  const isMouseScrollRef = useRef(false);
  const seekbarRef = useRef(null as HTMLInputElement | null);
  const lowResponseSongPositionRef = useRef(0);

  const seekBarCssProperties: CSSProperties = {};
  seekBarCssProperties['--seek-before-width'] = `${
    (songPos /
      ((currentSongData.duration || 0) >= songPos ? currentSongData.duration || 0 : songPos)) *
    100
  }%`;

  const handleSongPositionChange = useCallback((e: Event) => {
    if ('detail' in e && typeof e.detail === 'number') {
      const songPosition = e.detail as number;

      lowResponseSongPositionRef.current = songPosition;
    }
  }, []);

  // A new song starts at 0 on the bar at once. Without this the bar kept the last song's position
  // until the next report, up to a second and a half while the new one loads (a paused player
  // reports once a second, and the bar reads every 500 ms), drawn over the new song's length.
  // Not on the first song: that one is the restored session, and its position comes as reported.
  const shownSongIdRef = useRef(currentSongData.songId);
  useEffect(() => {
    if (shownSongIdRef.current && shownSongIdRef.current !== currentSongData.songId) {
      lowResponseSongPositionRef.current = 0;
      setSongPos(0);
      if (onSeek) onSeek(0);
    }
    shownSongIdRef.current = currentSongData.songId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSongData.songId]);

  useEffect(() => {
    document.addEventListener('player/positionChange', handleSongPositionChange);

    return () => document.removeEventListener('player/positionChange', handleSongPositionChange);
  }, [handleSongPositionChange]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (seekbarRef.current && !isMouseDownRef.current && !isMouseScrollRef.current) {
        setSongPos(lowResponseSongPositionRef.current);
        if (onSeek) onSeek(lowResponseSongPositionRef.current);
      }
    }, 500);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useEffect(() => {
  //   if (
  //     seekbarRef.current &&
  //     !isMouseDownRef.current &&
  //     !isMouseScrollRef.current
  //   ) {
  //     setSongPos(songPosition);
  //     if (onSeek) onSeek(songPosition);
  //   }
  //   //  ? Adding onSeek as a dependency makes the slider unresponsive while sliding for short times.
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [songPosition]);

  useEffect(() => {
    const seekBar = seekbarRef.current;

    if (seekbarRef.current) {
      const handleSeekbarMouseDown = () => {
        isMouseDownRef.current = true;
      };
      const handleSeekbarMouseUp = () => {
        isMouseDownRef.current = false;
        updateSongPosition(seekbarRef.current?.valueAsNumber ?? 0);
      };
      seekbarRef.current.addEventListener('mousedown', () => handleSeekbarMouseDown());
      seekbarRef.current.addEventListener('mouseup', () => handleSeekbarMouseUp());
      return () => {
        seekBar?.removeEventListener('mouseup', handleSeekbarMouseUp);
        seekBar?.removeEventListener('mousedown', handleSeekbarMouseDown);
      };
    }
    return undefined;
  }, [updateSongPosition]);

  const handleOnChange = (e: ChangeEvent<HTMLInputElement>) => {
    const pos = e.currentTarget.valueAsNumber;
    setSongPos(pos);
    if (onSeek) onSeek(pos);
  };

  const handleOnWheel = (e: WheelEvent<HTMLInputElement>) => {
    isMouseScrollRef.current = true;

    const max = parseInt(e.currentTarget.max);
    const scrollIncrement = preferences.seekbarScrollInterval;

    const incrementValue = e.deltaY > 0 ? -scrollIncrement : scrollIncrement;
    let value = (songPos || 0) + incrementValue;

    if (value > max) value = max;
    if (value < 0) value = 0;
    if (onSeek) onSeek(value);
    setSongPos(value);

    debounce(() => {
      isMouseScrollRef.current = false;
      updateSongPosition(value);
    }, 250);
  };

  return (
    <input
      type="range"
      name={name}
      id={id}
      className={cn(
        /*
          The filled part of the bar deliberately does NOT transition its width.
          `width` affects layout, so every frame of that transition cost a
          layout, a paint and a raster of the bar. The position updates twice a
          second, which kept the compositor busy for the whole track: measured
          at 8.1% CPU while playing, against 1.8% with the transition gone, and
          the GPU process alone fell from 5.8% to 1.0%.
          Nothing is lost visually. Half a second of a three-minute track moves
          the bar by under two pixels, so the transition was smoothing a step
          nobody could see. Background still transitions; that one is cheap.

          The played part is ink like the volume's, and turns echo blue under
          the pointer, so the colour says "you can grab this".
        */
        "seek-bar-slider relative float-left m-0 h-6 w-full appearance-none bg-[transparent] p-0 outline-none outline-1 outline-offset-1 before:absolute before:left-0 before:top-1/2 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:bg-ink before:transition-[background] before:content-[''] hover:before:bg-echo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo",
        // Additions, not a replacement: the full-screen player used to swap the whole look away and
        // got a bare native slider.
        className
      )}
      min={0}
      max={(currentSongData.duration || 0) >= songPos ? currentSongData.duration || 0 : songPos}
      value={songPos || 0}
      onChange={handleOnChange}
      onWheel={handleOnWheel}
      ref={seekbarRef}
      style={seekBarCssProperties}
    />
  );
};

export default SeekBarSlider;
