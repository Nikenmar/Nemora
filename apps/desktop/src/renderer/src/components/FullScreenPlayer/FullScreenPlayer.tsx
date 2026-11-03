import { useEffect, useMemo, useRef, useState } from 'react';
import useMouseActiveState from '../../hooks/useMouseActiveState';

import TitleBar from '../TitleBar/TitleBar';
import Img from '../Img';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import LyricsContainer from './containers/LyricsContainer';
import SongInfoContainer from './containers/SongInfoContainer';
import SeekBarSlider from '../SeekBarSlider';
import AmbientLayer from './containers/AmbientLayer';
import { useStore } from '@tanstack/react-store';
import { store, selectPreferences } from '@renderer/store';

// type Props = {};

const isArtistBackgroundsEnabled = false;
/** Ambient full screen (PLAN/14 B3) begins after this long with no input. */
const AMBIENT_AFTER_MS = 60_000;

const FullScreenPlayer = () =>
  // (props: Props)
  {
    const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
    const currentSongData = useStore(store, (state) => state.currentSongData);
    const preferences = useStore(store, selectPreferences('allowToPreventScreenSleeping', 'isAmbientFullScreen', 'isReducedMotion'));
    const isOnBatteryPower = useStore(store, (state) => state.isOnBatteryPower);

    const [isLyricsVisible, setIsLyricsVisible] = useState(true);
    const [isLyricsAvailable, setIsLyricsAvailable] = useState(false);
    const [songPos, setSongPos] = useState(0);

    const fullScreenPlayerContainerRef = useRef<HTMLDivElement>(null);
    const { isMouseActive } = useMouseActiveState(fullScreenPlayerContainerRef, {
      idleTimeout: 4000,
      range: 50,
      idleOnMouseOut: true
    });

    useEffect(() => {
      if (preferences.allowToPreventScreenSleeping && !isOnBatteryPower)
        window.api.appControls.stopScreenSleeping();
      else window.api.appControls.allowScreenSleeping();
      return () => window.api.appControls.allowScreenSleeping();
    }, [preferences.allowToPreventScreenSleeping, isOnBatteryPower]);

    const imgPath = useMemo(() => {
      const selectedArtist = currentSongData?.artists?.find(
        (artist) => !!artist.onlineArtworkPaths?.picture_xl
      );

      if (isArtistBackgroundsEnabled && selectedArtist)
        return selectedArtist.onlineArtworkPaths?.picture_xl;
      return currentSongData.artworkPath;
    }, [currentSongData?.artists, currentSongData?.artworkPath]);

    // Ambient full screen: after a minute with no input the controls fade and the cover's tones
    // drift behind the music; any input brings the controls back.
    const isAmbientEnabled = !!preferences.isAmbientFullScreen;
    const [isAmbient, setIsAmbient] = useState(false);
    useEffect(() => {
      if (!isAmbientEnabled) return undefined;
      let timer = window.setTimeout(() => setIsAmbient(true), AMBIENT_AFTER_MS);
      const wake = () => {
        window.clearTimeout(timer);
        setIsAmbient(false);
        timer = window.setTimeout(() => setIsAmbient(true), AMBIENT_AFTER_MS);
      };
      const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
      for (const event of events) window.addEventListener(event, wake, { passive: true });
      return () => {
        window.clearTimeout(timer);
        setIsAmbient(false);
        for (const event of events) window.removeEventListener(event, wake);
      };
    }, [isAmbientEnabled]);

    const isLyricsShown = isLyricsVisible && isLyricsAvailable;

    return (
      <div
        className={`full-screen-player dark relative ${!isCurrentSongPlaying && 'paused'} ${
          isAmbient ? 'ambient cursor-none' : ''
        } ${
          preferences?.isReducedMotion ? 'reduced-motion' : ''
        } grid !h-screen w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-shade text-on-media`}
      >
        <div className="background-cover-img-container absolute inset-0 overflow-hidden" aria-hidden>
          <Img
            src={imgPath}
            fallbackSrc={DefaultSongCover}
            loading="eager"
            alt=""
            className="h-full w-full scale-125 object-cover blur-[64px] saturate-[1.25]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-shade/55 to-shade/85" />
          <AmbientLayer isOn={isAmbient} />
        </div>
        <TitleBar />
        <div
          // Cover and lyrics as one block in the middle of a wide window, not pinned to its left edge.
          className={`relative grid min-h-0 w-full max-w-[84rem] items-center gap-16 justify-self-center px-16 pb-12 ${
            isLyricsShown
              ? 'grid-cols-[minmax(0,24rem)_minmax(0,1fr)]'
              : 'grid-cols-1 justify-items-center'
          } ${isMouseActive && 'group/fullScreenPlayer'}`}
          ref={fullScreenPlayerContainerRef}
        >
          <SongInfoContainer
            songPos={songPos}
            isLyricsVisible={isLyricsVisible}
            setIsLyricsVisible={setIsLyricsVisible}
            isLyricsAvailable={isLyricsAvailable}
            isMouseActive={isMouseActive}
            seekBar={
              <SeekBarSlider
                name="full-screen-player-seek-slider"
                id="fullScreenPlayerSeekSlider"
                onSeek={(currentPosition) => setSongPos(currentPosition)}
                className="full-screen-player-seek-slider before:!bg-on-media"
              />
            }
          />
          <div className={isLyricsShown ? 'relative h-full min-h-0' : 'hidden'}>
            <LyricsContainer
              isLyricsVisible={isLyricsVisible}
              setIsLyricsAvailable={setIsLyricsAvailable}
            />
          </div>
        </div>
      </div>
    );
  };

export default FullScreenPlayer;
