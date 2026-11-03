// PLAN/21 P21.5: moved from App.tsx as it was. The playback controller - playing a song (from the
// library or an unknown file), moving through the queue, skipping back and forward; App calls the
// hook where these were, so the hooks keep their order.
import { type ReactNode, useCallback } from 'react';
import type { TFunction } from 'i18next';

import ErrorPrompt from '../components/ErrorPrompt';
import { dispatch, store } from '../store';
import log from '../utils/log';
import storage from '../utils/localStorage';
import { ownVersionOf } from '../other/songSound';
import { setPlayingVersion } from '../other/soundEffects';
import updateQueueOnSongPlay from '../other/updateQueueOnSongPlay';
import type { EndReason, StartReason } from '../other/listeningDataSession';
import { playbackRecovery, player } from './bootstrap';
import { SongUnplayableErrorPrompt } from './lazyScreens';

export type UsePlaybackControllerDeps = {
  t: TFunction;
  changePromptMenuData: (isVisible?: boolean, prompt?: ReactNode | null, className?: string) => void;
  endReasonRef: { current: EndReason };
  isImageBasedDynamicThemesEnabled: boolean;
  recordListeningData: (songId: string, duration: number, isRepeating?: boolean, isKnownSource?: boolean) => void;
  refStartPlay: { current: boolean };
  setDynamicThemesFromSongPalette: (artworkPath?: string) => void;
  setStartReason: (reason: StartReason) => void;
  toggleSongPlayback: (startPlay?: boolean) => void;
};

export const usePlaybackController = ({ t, changePromptMenuData, endReasonRef, isImageBasedDynamicThemesEnabled, recordListeningData, refStartPlay, setDynamicThemesFromSongPalette, setStartReason, toggleSongPlayback }: UsePlaybackControllerDeps) => {
  const playSong = useCallback(
    (songId: string, isStartPlay = true, playAsCurrentSongIndex = false) => {
      playbackRecovery.reset();
      if (typeof songId === 'string') {
        if (store.state.currentSongData.songId === songId) return toggleSongPlayback();
        console.time('timeForSongFetch');

        return window.api.audioLibraryControls
          .getSong(songId)
          .then((songData) => {
            console.timeEnd('timeForSongFetch');
            if (songData) {
              console.log('playSong', songId, songData.path);

              dispatch({ type: 'CURRENT_SONG_DATA_CHANGE', data: songData });
              // A version (PLAN/18 D6) plays with its own sound, a switched song with the sound it
              // was given; any other row with the panel's.
              setPlayingVersion(songData.version ?? ownVersionOf(songData.songId) ?? null);

              storage.playback.setCurrentSongOptions('songId', songData.songId);

              player.src = `${songData.path}?ts=${Date.now()}`;
              // Everything that follows the position (bar, lyrics) starts the new song at 0 now,
              // not at the next report.
              document.dispatchEvent(new CustomEvent('player/positionChange', { detail: 0 }));

              const trackChangeEvent = new CustomEvent('player/trackchange', {
                detail: songId
              });
              player.dispatchEvent(trackChangeEvent);

              refStartPlay.current = isStartPlay;

              if (isStartPlay) toggleSongPlayback();

              if (isImageBasedDynamicThemesEnabled)
                setDynamicThemesFromSongPalette(songData.artworkPath);

              recordListeningData(songId, songData.duration);

              // dispatch({
              //   type: 'UPDATE_QUEUE',
              //   data: updateQueueOnSongPlay(
              //     store.state.localStorage.queue,
              //     songData.songId,
              //     playAsCurrentSongIndex
              //   )
              // });
              storage.queue.setQueue(
                updateQueueOnSongPlay(
                  store.state.localStorage.queue,
                  songData.songId,
                  playAsCurrentSongIndex
                )
              );
            } else console.log(songData);
            return undefined;
          })
          .catch((err) => {
            console.error(err);
            changePromptMenuData(true, <SongUnplayableErrorPrompt err={err} />);
          });
      }
      changePromptMenuData(
        true,
        <ErrorPrompt
          reason="SONG_ID_UNDEFINED"
          message={`${t('player.errorTitle')}\nERROR : SONG_ID_UNDEFINED`}
        />
      );
      return log(
        'ERROR OCCURRED WHEN TRYING TO PLAY A S0NG.',
        {
          error: 'Song id is of unknown type',
          songIdType: typeof songId,
          songId
        },
        'ERROR'
      );
    },
    // App's refs and setStartReason (which only writes a ref) are stable; the list is App's, as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      changePromptMenuData,
      t,
      toggleSongPlayback,
      isImageBasedDynamicThemesEnabled,
      setDynamicThemesFromSongPalette,
      recordListeningData
    ]
  );

  const playSongFromUnknownSource = useCallback(
    (audioPlayerData: AudioPlayerData, isStartPlay = true) => {
      if (audioPlayerData) {
        const { isKnownSource } = audioPlayerData;
        if (isKnownSource) playSong(audioPlayerData.songId);
        else {
          console.log('playSong', audioPlayerData.path);
          dispatch({
            type: 'CURRENT_SONG_DATA_CHANGE',
            data: audioPlayerData
          });
          player.src = `${audioPlayerData.path}?ts=${Date.now()}`;
          refStartPlay.current = isStartPlay;
          if (isStartPlay) toggleSongPlayback();

          recordListeningData(audioPlayerData.songId, audioPlayerData.duration, undefined, false);
        }
      }
    },
    // App's refs and setStartReason (which only writes a ref) are stable; the list is App's, as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playSong, recordListeningData, toggleSongPlayback]
  );

  const fetchSongFromUnknownSource = useCallback(
    (songPath: string) => {
      window.api.unknownSource
        .getSongFromUnknownSource(songPath)
        .then((res) => playSongFromUnknownSource(res, true))
        .catch((err) => {
          console.error(err);
          changePromptMenuData(true, <SongUnplayableErrorPrompt err={err} />);
        });
    },
    [playSongFromUnknownSource, changePromptMenuData]
  );

  const changeQueueCurrentSongIndex = useCallback(
    (currentSongIndex: number, isPlaySong = true) => {
      console.log('currentSongIndex', currentSongIndex);
      // dispatch({ type: 'UPDATE_QUEUE_CURRENT_SONG_INDEX', data: currentSongIndex });

      storage.queue.setCurrentSongIndex(currentSongIndex);

      if (isPlaySong) playSong(store.state.localStorage.queue.queue[currentSongIndex]);
    },
    [playSong]
  );

  const handleSkipBackwardClick = useCallback(() => {
    const queue = store.state.localStorage.queue;
    const { currentSongIndex } = queue;
    if (player.currentTime > 5) {
      player.currentTime = 0;
      return;
    }
    endReasonRef.current = 'user_previous';
    setStartReason('user_previous');
    if (typeof currentSongIndex === 'number') {
      if (currentSongIndex === 0) {
        if (queue.queue.length > 0) changeQueueCurrentSongIndex(queue.queue.length - 1);
      } else changeQueueCurrentSongIndex(currentSongIndex - 1);
    } else changeQueueCurrentSongIndex(0);
  // App's refs and setStartReason (which only writes a ref) are stable; the list is App's, as it was.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeQueueCurrentSongIndex]);

  const handleSkipForwardClick = useCallback(
    (reason: SongSkipReason = 'USER_SKIP') => {
      const queue = store.state.localStorage.queue;

      const { currentSongIndex } = queue;
      // A song that played to its end has already closed its session as finished.
      if (reason === 'USER_SKIP') endReasonRef.current = 'user_next';
      // Next, or the end of a song: the queue brings the next one, the user did not pick it.
      setStartReason('auto');
      if (store.state.player.isRepeating === 'repeat-1' && reason !== 'USER_SKIP') {
        player.currentTime = 0;
        toggleSongPlayback(true);
        recordListeningData(
          store.state.currentSongData.songId,
          store.state.currentSongData.duration,
          true
        );
      } else if (typeof currentSongIndex === 'number') {
        if (queue.queue.length > 0) {
          if (queue.queue.length - 1 === currentSongIndex) {
            if (store.state.player.isRepeating === 'repeat') changeQueueCurrentSongIndex(0);
          } else changeQueueCurrentSongIndex(currentSongIndex + 1);
        } else console.log('Queue is empty.');
      } else if (queue.queue.length > 0) changeQueueCurrentSongIndex(0);
    },
    // App's refs and setStartReason (which only writes a ref) are stable; the list is App's, as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeQueueCurrentSongIndex, recordListeningData, toggleSongPlayback]
  );

  return { playSong, playSongFromUnknownSource, fetchSongFromUnknownSource, changeQueueCurrentSongIndex, handleSkipBackwardClick, handleSkipForwardClick };
};
