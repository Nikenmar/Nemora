import { type ReactNode, useCallback, useContext, useMemo, useState, useRef } from 'react';
import { useTrackChangeMotion } from '../../../other/motion';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import calculateTime from '../../../utils/calculateTime';

import Button from '../../Button';
import Img from '../../Img';
import Icon from '../../ui/Icon';
import UpNextSongPopup from '../../SongsControlsContainer/UpNextSongPopup';

import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';
import VolumeSlider from '../../VolumeSlider';
import SpectrumBars from './SpectrumBars';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

type Props = {
  songPos: number;
  isLyricsVisible: boolean;
  isLyricsAvailable: boolean;
  isMouseActive: boolean;
  /** The seek bar, drawn between the times. */
  seekBar?: ReactNode;
  setIsLyricsVisible: (callback: (state: boolean) => boolean) => void;
};

const SongInfoContainer = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const columnRef = useRef<HTMLDivElement>(null);
  const noTextRef = useRef<HTMLDivElement>(null);
  // The whole column moves on a track change; its cover alone travels in and out of full screen.
  useTrackChangeMotion(columnRef, noTextRef);
  // On its own: toggleIsFavorite sets the flag on the current object before dispatching a copy, and
  // the store compares selections shallowly, so the whole object never shows the change.
  const isCurrentSongAFavorite = useStore(store, (state) => state.currentSongData.isAFavorite);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isMuted = useStore(store, (state) => state.player.volume.isMuted);
  const volume = useStore(store, (state) => state.player.volume.value);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const {
    toggleIsFavorite,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    toggleSongPlayback,
    toggleMutedState
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { songPos, isLyricsVisible, setIsLyricsVisible, isLyricsAvailable, isMouseActive, seekBar } =
    props;

  const [isNextSongPopupVisible, setIsNextSongPopupVisible] = useState(false);

  const songDuration = preferences.showSongRemainingTime
    ? currentSongData.duration - Math.floor(songPos) >= 0
      ? calculateTime(currentSongData.duration - Math.floor(songPos))
      : calculateTime(0)
    : calculateTime(songPos);

  const songArtistsImages = useMemo(() => {
    if (
      currentSongData.songId &&
      Array.isArray(currentSongData.artists) &&
      currentSongData.artists.length > 0
    )
      return currentSongData.artists
        .filter((artist, index) => artist.onlineArtworkPaths && index < 2)
        .map((artist, index) => (
          <Img
            key={artist.artistId}
            src={artist.onlineArtworkPaths?.picture_small}
            fallbackSrc={artist.artworkPath}
            loading="eager"
            className={`absolute aspect-square w-6 rounded-full border-2 border-canvas ${
              index === 0 ? 'z-2' : '-translate-x-2'
            }`}
            alt=""
          />
        ));
    return undefined;
  }, [currentSongData.artists, currentSongData.songId]);

  const handleSkipForwardClickWithParams = useCallback(
    () => handleSkipForwardClick('USER_SKIP'),
    [handleSkipForwardClick]
  );

  const fullDuration = calculateTime(currentSongData.duration ?? 0);
  const glass =
    '!m-0 !h-11 !w-11 !bg-on-media/10 !text-on-media hover:!bg-on-media/20 backdrop-blur-md';

  return (
    <div
      ref={columnRef}
      className="song-info-container flex w-full max-w-[24rem] flex-col gap-4 text-on-media"
    >
      <Img
        src={currentSongData.artworkPath}
        fallbackSrc={DefaultSongCover}
        loading="eager"
        alt=""
        className="full-screen-cover player-cover aspect-square w-full rounded-cover-lg object-cover shadow-[0_24px_60px_rgb(0_0_0/0.55)]"
      />
      {preferences.isFullScreenSpectrum && <SpectrumBars />}
      <div className="mt-2 min-w-0">
        {currentSongData.title && (
          <div className="song-title flex items-center gap-2">
            <div
              className="min-w-0 truncate text-[28px] font-semibold leading-tight text-on-media"
              id="currentSongTitle"
              title={currentSongData.title}
            >
              {currentSongData.title}
            </div>
            {!currentSongData.isKnownSource && (
              <span
                className="ms-icon shrink-0 text-xl text-warning"
                title="You are playing from an unknown source. Some features are disabled."
              >
                error
              </span>
            )}
          </div>
        )}
        {!isNextSongPopupVisible && (
          <div
            className="song-artists appear-from-bottom mt-1 flex items-center truncate text-body text-on-media/70"
            title={currentSongData.artists?.map((artist) => artist.name).join(', ')}
          >
            {preferences?.showArtistArtworkNearSongControls &&
              songArtistsImages &&
              songArtistsImages.length > 0 && (
                <span
                  className={`relative mr-2 flex h-6 items-center lg:hidden ${
                    songArtistsImages.length === 1 ? 'w-6' : 'w-10'
                  } `}
                >
                  {songArtistsImages}
                </span>
              )}
            {currentSongData.songId && Array.isArray(currentSongData.artists)
              ? currentSongData.artists?.length > 0
                ? currentSongData.artists.map((artist) => artist.name).join(', ')
                : t('common.unknownArtist')
              : ''}
          </div>
        )}
        <UpNextSongPopup
          onPopupAppears={(isVisible) => setIsNextSongPopupVisible(isVisible)}
          className="mt-1 w-fit"
          isSemiTransparent
        />
      </div>
      <div className="ambient-hide flex items-center gap-3 text-micro tabular-nums text-on-media/70">
        <span className="w-10 shrink-0 text-right">
          {preferences?.showSongRemainingTime ? '-' : ''}
          {songDuration.minutes}:{songDuration.seconds}
        </span>
        <div className="relative flex min-w-0 flex-1 items-center">{seekBar}</div>
        <span className="w-10 shrink-0">
          {fullDuration.minutes}:{fullDuration.seconds}
        </span>
      </div>
      <div className="song-controls-container ambient-hide flex items-center justify-center gap-3">
        <Button
          className={`favorite-btn ${glass} ${isCurrentSongAFavorite ? '!text-echo' : ''}`}
          isActive={isCurrentSongAFavorite}
          isDisabled={!currentSongData.isKnownSource}
          tooltipLabel={
            currentSongData.isKnownSource ? t('player.likeDislike') : t('player.likeDislikeDisabled')
          }
          clickHandler={() =>
            currentSongData.isKnownSource && toggleIsFavorite(!isCurrentSongAFavorite)
          }
          iconName="favorite"
        />
        <Button
          className={`skip-backward-btn ${glass}`}
          tooltipLabel={t('player.prevSong')}
          clickHandler={handleSkipBackwardClick}
          iconName="skip_previous"
          isActive
          size="lg"
        />
        <button
          type="button"
          className="play-pause-btn flex h-14 w-14 items-center justify-center rounded-full bg-on-media text-shade outline-none transition-transform duration-150 ease-out hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo"
          aria-label={t('player.playPause')}
          data-tooltip={t('player.playPause')}
          onClick={toggleSongPlayback}
        >
          <Icon key={isCurrentSongPlaying ? 'pause' : 'play'} name={isCurrentSongPlaying ? 'pause' : 'play_arrow'} filled size={30} />
        </button>
        <Button
          className={`skip-next-btn ${glass}`}
          tooltipLabel={t('player.nextSong')}
          clickHandler={handleSkipForwardClickWithParams}
          iconName="skip_next"
          isActive
          size="lg"
        />
        <Button
          className={`lyrics-btn ${glass} ${isLyricsVisible && isLyricsAvailable ? '!text-echo' : ''}`}
          isActive={isLyricsVisible}
          clickHandler={() => setIsLyricsVisible((prevState) => !prevState)}
          iconName="lyrics"
          tooltipLabel={t('player.lyrics')}
        />
      </div>
      <div
        className={`ambient-hide flex items-center justify-center gap-2 transition-opacity duration-300 ${
          isMouseActive ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Button
          className="volume-btn !m-0 !h-8 !w-8 !text-on-media/80 hover:!bg-on-media/10 hover:!text-on-media"
          tooltipLabel={t('player.muteUnmute')}
          iconName={isMuted ? 'volume_off' : volume > 50 ? 'volume_up' : 'volume_down'}
          clickHandler={() => toggleMutedState(!isMuted)}
        />
        <div className="volume-slider-container w-32">
          <VolumeSlider name="player-volume-slider" id="volumeSlider" className="before:!bg-on-media" />
        </div>
      </div>
    </div>
  );
};

export default SongInfoContainer;
