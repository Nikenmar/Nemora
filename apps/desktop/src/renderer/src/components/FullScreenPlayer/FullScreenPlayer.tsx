import { useEffect, useMemo, useRef, useState } from 'react';
import useMouseActiveState from '../../hooks/useMouseActiveState';

import TitleBar from '../TitleBar/TitleBar';
import Img from '../Img';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import LyricsContainer from './containers/LyricsContainer';
import SongInfoContainer from './containers/SongInfoContainer';
import SeekBarSlider from '../SeekBarSlider';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

// type Props = {};

const isArtistBackgroundsEnabled = false;

const FullScreenPlayer = () =>
  // (props: Props)
  {
    const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
    const currentSongData = useStore(store, (state) => state.currentSongData);
    const preferences = useStore(store, (state) => state.localStorage.preferences);
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

    const isLyricsShown = isLyricsVisible && isLyricsAvailable;

    return (
      <div
        className={`full-screen-player dark relative ${!isCurrentSongPlaying && 'paused'} ${
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
        </div>
        <TitleBar />
        <div
          className={`relative grid min-h-0 items-center gap-16 px-16 pb-12 ${
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
