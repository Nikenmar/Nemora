// PLAN/21 P21.5: moved from App.tsx as it was. The player's and the window's listeners - errors,
// play and pause, quit, blur and focus, full screen, the title bar, the next song at the end - as
// two effects; App calls the hook where they were, so the effects keep their order.
import { useEffect } from 'react';

import { dispatch, store } from '../store';
import storage from '../utils/localStorage';
import { playbackRecovery, player } from './bootstrap';

export type UsePlayerListenersLater = {
  addSongTitleToTitleBar: () => void;
  handleSkipForwardClick: (reason?: SongSkipReason) => void;
  managePlaybackErrors: (appError: unknown) => void;
  toggleSongPlayback: (startPlay?: boolean) => void;
};

export type UsePlayerListenersDeps = {
  handleBeforeQuitEvent: () => Promise<void>;
  manageWindowBlurOrFocus: (state: 'blur' | 'focus') => void;
  manageWindowFullscreen: (state: 'fullscreen' | 'windowed') => void | undefined;
  refStartPlay: { current: boolean };
  /** Defined after this in App: read only when called, as the moved code always did. */
  later: () => UsePlayerListenersLater;
};

export const usePlayerListeners = ({ handleBeforeQuitEvent, manageWindowBlurOrFocus, manageWindowFullscreen, refStartPlay, later }: UsePlayerListenersDeps) => {
  useEffect(() => {
    const handlePlayerErrorEvent = (err: unknown) => later().managePlaybackErrors(err);
    const handlePlayerPlayEvent = () => {
      // Sound is coming out: whatever the recovery ladder was in the middle of
      // is finished, and the next failure deserves the full set of moves again.
      playbackRecovery.reset();
      dispatch({
        type: 'CURRENT_SONG_PLAYBACK_STATE',
        data: true
      });
      window.api.playerControls.songPlaybackStateChange(true);
    };
    const handlePlayerPauseEvent = () => {
      dispatch({
        type: 'CURRENT_SONG_PLAYBACK_STATE',
        data: false
      });
      window.api.playerControls.songPlaybackStateChange(false);
    };

    player.addEventListener('error', handlePlayerErrorEvent);
    player.addEventListener('play', handlePlayerPlayEvent);
    player.addEventListener('pause', handlePlayerPauseEvent);
    window.api.quitEvent.beforeQuitEvent(handleBeforeQuitEvent);

    window.api.windowControls.onWindowBlur(() => manageWindowBlurOrFocus('blur'));
    window.api.windowControls.onWindowFocus(() => manageWindowBlurOrFocus('focus'));

    window.api.fullscreen.onEnterFullscreen(() => manageWindowFullscreen('fullscreen'));
    window.api.fullscreen.onLeaveFullscreen(() => manageWindowFullscreen('windowed'));

    return () => {
      player.removeEventListener('error', handlePlayerErrorEvent);
      player.removeEventListener('play', handlePlayerPlayEvent);
      player.removeEventListener('pause', handlePlayerPauseEvent);
      window.api.quitEvent.removeBeforeQuitEventListener(handleBeforeQuitEvent);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageWindowBlurOrFocus, manageWindowFullscreen, handleBeforeQuitEvent]);

  useEffect(() => {
    const displayDefaultTitleBar = () => {
      document.title = `Nemora`;
      storage.playback.setCurrentSongOptions('stoppedPosition', player.currentTime);
    };
    const playSongIfPlayable = () => {
      if (refStartPlay.current) later().toggleSongPlayback(true);
    };
    // const managePlayerStalledStatus = () => {
    //   dispatch({ type: 'PLAYER_WAITING_STATUS', data: true });
    // };
    // const managePlayerNotStalledStatus = () => {
    //   dispatch({ type: 'PLAYER_WAITING_STATUS', data: false });
    // };

    const handleSkipForwardClickWithParams = () => later().handleSkipForwardClick('PLAYER_SKIP');

    // The decoder knows the real length even when the stored metadata does not.
    //
    // A song whose duration was never established - an MP3 whose first audio
    // frame sits past the head the scanner reads - shows 00:00 and gives the
    // seek bar nothing to scale against. The element has decoded the file by
    // now, so its duration is authoritative; it is adopted only when the stored
    // one is missing, so a correctly scanned song is never second-guessed here.
    const adoptDecodedDuration = () => {
      const decoded = player.duration;
      if (!Number.isFinite(decoded) || decoded <= 0) return;
      if (store.state.currentSongData.duration > 0) return;
      store.setState((state) => ({
        ...state,
        currentSongData: { ...state.currentSongData, duration: decoded }
      }));
    };
    player.addEventListener('loadedmetadata', adoptDecodedDuration);

    // player.addEventListener('canplay', managePlayerNotStalledStatus);
    // player.addEventListener('canplaythrough', managePlayerNotStalledStatus);
    // player.addEventListener('loadeddata', managePlayerNotStalledStatus);
    // player.addEventListener('loadedmetadata', managePlayerNotStalledStatus);

    // player.addEventListener('suspend', managePlayerStalledStatus);
    // player.addEventListener('stalled', managePlayerStalledStatus);
    // player.addEventListener('waiting', managePlayerStalledStatus);
    // player.addEventListener('progress', managePlayerStalledStatus);

    player.addEventListener('canplay', playSongIfPlayable);
    player.addEventListener('ended', handleSkipForwardClickWithParams);
    player.addEventListener('play', later().addSongTitleToTitleBar);
    player.addEventListener('pause', displayDefaultTitleBar);

    return () => {
      later().toggleSongPlayback(false);
      // player.removeEventListener('canplay', managePlayerNotStalledStatus);
      // player.removeEventListener('canplaythrough', managePlayerNotStalledStatus);
      // player.removeEventListener('loadeddata', managePlayerNotStalledStatus);
      // player.removeEventListener('loadedmetadata', managePlayerNotStalledStatus);

      // player.removeEventListener('suspend', managePlayerStalledStatus);
      // player.removeEventListener('stalled', managePlayerStalledStatus);
      // player.removeEventListener('waiting', managePlayerStalledStatus);
      // player.removeEventListener('progress', managePlayerStalledStatus);

      player.removeEventListener('loadedmetadata', adoptDecodedDuration);
      player.removeEventListener('canplay', playSongIfPlayable);
      player.removeEventListener('ended', handleSkipForwardClickWithParams);
      player.removeEventListener('play', later().addSongTitleToTitleBar);
      player.removeEventListener('pause', displayDefaultTitleBar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

};
