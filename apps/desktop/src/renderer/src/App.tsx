// ? BASE IMPORTS
import {
  type DragEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useTransition
} from 'react';
import { useStore } from '@tanstack/react-store';
import { useTranslation } from 'react-i18next';
import './assets/styles/styles.css';
import 'material-symbols/rounded.css';
import { appPreferences } from '../../../package.json';

// ? CONTEXTS
import { registerBenchApp } from './other/bench';
import { registerShots } from './other/shots';
import { applyCoverLight } from './other/coverLight';
// Evaluated here as before; app/bootstrap.ts sets the playback clock.
import './other/trackVisuals';
import { applyAccent } from './other/accentPalette';
import { withViewTransition } from './other/viewTransition';
import { installSharedCovers } from './other/motion';
import TooltipLayer from './components/ui/Tooltip';
import { AppUpdateContext, type AppUpdateContextType } from './contexts/AppUpdateContext';
// import { SongPositionContext } from './contexts/SongPositionContext';

// ? HOOKS
import useDuelInvite from './hooks/useDuelInvite';

// ? MAIN APP COMPONENTS
import TitleBar from './components/TitleBar/TitleBar';
import SongControlsContainer from './components/SongsControlsContainer/SongControlsContainer';
import BodyAndSideBarContainer from './components/BodyAndSidebarContainer';
import PromptMenu from './components/PromptMenu/PromptMenu';
import ContextMenu from './components/ContextMenu/ContextMenu';
import ErrorPrompt from './components/ErrorPrompt';
import Img from './components/Img';
import Preloader from './components/Preloader/Preloader';
import ErrorBoundary from './components/ErrorBoundary';
import toggleSongIsFavorite from './other/toggleSongIsFavorite';
import SuspenseLoader from './components/SuspenseLoader';

// ? PROMPTS, SCREENS (app/lazyScreens.ts)
import {
  FullScreenPlayer,
  MiniPlayer,
  SongUnplayableErrorPrompt,
  UnsupportedFileMessagePrompt
} from './app/lazyScreens';

// ? UTILS
import roundTo from '../../common/roundTo';
import storage from './utils/localStorage';
import { isDataChanged } from './utils/hasDataChanged';
import log from './utils/log';
import throttle from './utils/throttle';
import parseNotificationFromMain from './other/parseNotificationFromMain';
import ListeningDataSession, { type EndReason, type StartReason } from './other/listeningDataSession';
import { updateSystemMedia } from './other/systemMedia';
import updateQueueOnSongPlay from './other/updateQueueOnSongPlay';
import shuffleQueueRandomly from './other/shuffleQueueRandomly';
// PLAN/21 P21.6: megaShuffleQueue as it was, with the core's port asked for the same order in shadow.
import megaShuffleQueue from './other/megaOrderShadow';
import { loadShuffleData, smartShuffleData } from './other/smartShuffle';
import { rememberedPosition, rememberPosition } from './other/resumePosition';
import { setPlayingVersion } from './other/soundEffects';
import { ownVersionOf } from './other/songSound';
import './other/headphoneCorrection';
import { lyricsLibrary } from './components/SettingsPage/Settings/LyricsLibrary';
import { startTrace } from './other/trace';
import './other/player';
import {
  freshMediaUrl,
  nextRecoveryAction
} from './other/playbackRecovery';
import { dispatch, store } from './store';
import { type AppReducer } from './other/appReducer';

// ? START (app/bootstrap.ts: the player, the recovery ledger, network status, user data)
import {
  DURATION,
  LOW_RESPONSE_DURATION,
  player,
  playbackRecovery,
  syncUserData
} from './app/bootstrap';
import { handleKeyboardShortcut } from './app/keyboardShortcuts';
import { useNotifications } from './app/notifications';

// console.log('Command line args', window.api.properties.commandLineArgs);

export default function App() {
  const { t } = useTranslation();

  // const [content, dispatch] = useReducer(reducer, DEFAULT_REDUCER_DATA);
  // // Had to use a Ref in parallel with the Reducer to avoid an issue that happens when using content.* not giving the intended data in useCallback functions even though it was added as a dependency of that function.
  // const contentRef = useRef(DEFAULT_REDUCER_DATA);

  const AppRef = useRef(null as HTMLDivElement | null);
  const storeRef = useRef<AppReducer>(undefined);

  const [, startTransition] = useTransition();
  const refStartPlay = useRef(false);

  const addSongDropPlaceholder = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget === null) AppRef.current?.classList.add('song-drop');
  }, []);

  const removeSongDropPlaceholder = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget === null) AppRef.current?.classList.remove('song-drop');
  }, []);

  const changePromptMenuData = useCallback(
    (isVisible = false, prompt?: ReactNode | null, className = '') => {
      const promptData: PromptMenuData = { prompt, className };

      const data = {
        isVisible,
        currentActiveIndex:
          prompt && isVisible
            ? store.state.promptMenuNavigationData.prompts.length
            : prompt === null && isVisible === false
              ? 0
              : store.state.promptMenuNavigationData.currentActiveIndex,
        prompts:
          prompt && isVisible
            ? store.state.promptMenuNavigationData.prompts.concat(promptData)
            : prompt === null && isVisible === false
              ? []
              : store.state.promptMenuNavigationData.prompts
      };

      dispatch({ type: 'PROMPT_MENU_DATA_CHANGE', data });
    },
    []
  );

  // Where the song is, for the next start: every few seconds while it plays, at once on a pause, a
  // seek or the window closing (the app can quit without a pause or a quit event).
  useEffect(() => {
    const remember = (now: boolean) => () =>
      rememberPosition(store.state.currentSongData.songId, player.currentTime, now);
    const often = remember(false);
    const atOnce = remember(true);
    player.addEventListener('timeupdate', often);
    player.addEventListener('pause', atOnce);
    player.addEventListener('seeked', atOnce);
    window.addEventListener('pagehide', atOnce);
    window.addEventListener('beforeunload', atOnce);
    return () => {
      player.removeEventListener('timeupdate', often);
      player.removeEventListener('pause', atOnce);
      player.removeEventListener('seeked', atOnce);
      window.removeEventListener('pagehide', atOnce);
      window.removeEventListener('beforeunload', atOnce);
    };
  }, []);

  const handleBeforeQuitEvent = useCallback(async () => {
    rememberPosition(store.state.currentSongData.songId, player.currentTime, true);
    storage.playback.setCurrentSongOptions('stoppedPosition', player.currentTime);
    storage.playback.setPlaybackOptions('isRepeating', store.state.player.isRepeating);
    storage.playback.setPlaybackOptions('isShuffling', store.state.player.isShuffling);
    storage.playback.setPlaybackOptions('isTierShuffling', store.state.player.isTierShuffling);
  }, []);

  // Energy flow (PLAN/15 C2) measures songs added since last time, in the background.
  useEffect(() => {
    if (store.state.localStorage.preferences.isEnergyFlowEnabled)
      window.api.tierlistsData.energyAnalysis(true).catch(() => undefined);
    // Lyrics for the library (PLAN/19 D5) go on where they stopped, when the user has it on.
    if (store.state.localStorage.preferences.isLyricsLibraryEnabled)
      lyricsLibrary(true).catch(() => undefined);
  }, []);

  // The stock upstream update check (which polled Sandakan/Nora's
  // release-notes.json) was removed: upstream no longer publishes that file, and
  // Nemora updates itself through Tauri's updater plugin.

  useEffect(() => {
    const watchForSystemThemeChanges = (
      _: unknown,
      isDarkMode: boolean,
      usingSystemTheme: boolean
    ) => {
      console.log('theme changed : isDarkMode', isDarkMode, 'usingSystemTheme', usingSystemTheme);
      const theme = {
        isDarkMode,
        useSystemTheme: usingSystemTheme
      };
      dispatch({
        type: 'APP_THEME_CHANGE',
        data: theme
      });
    };

    const watchPowerChanges = (_: unknown, isOnBatteryPower: boolean) => {
      dispatch({ type: 'UPDATE_BATTERY_POWER_STATE', data: isOnBatteryPower });
    };

    window.api.theme.listenForSystemThemeChanges(watchForSystemThemeChanges);
    window.api.battery.listenForBatteryPowerStateChanges(watchPowerChanges);
    return () => {
      window.api.theme.stoplisteningForSystemThemeChanges(watchForSystemThemeChanges);
      window.api.battery.stopListeningForBatteryPowerStateChanges(watchPowerChanges);
    };
  }, []);

  const manageWindowBlurOrFocus = useCallback((state: 'blur' | 'focus') => {
    if (AppRef.current) {
      if (state === 'blur') AppRef.current.classList.add('blurred');
      if (state === 'focus') AppRef.current.classList.remove('blurred');
    }
  }, []);

  const manageWindowFullscreen = useCallback((state: 'fullscreen' | 'windowed') => {
    if (AppRef.current) {
      if (state === 'fullscreen') return AppRef.current.classList.add('fullscreen');
      if (state === 'windowed') return AppRef.current.classList.remove('fullscreen');
    }
    return undefined;
  }, []);

  useEffect(() => {
    const handlePlayerErrorEvent = (err: unknown) => managePlaybackErrors(err);
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
      if (refStartPlay.current) toggleSongPlayback(true);
    };
    // const managePlayerStalledStatus = () => {
    //   dispatch({ type: 'PLAYER_WAITING_STATUS', data: true });
    // };
    // const managePlayerNotStalledStatus = () => {
    //   dispatch({ type: 'PLAYER_WAITING_STATUS', data: false });
    // };

    const handleSkipForwardClickWithParams = () => handleSkipForwardClick('PLAYER_SKIP');

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
    player.addEventListener('play', addSongTitleToTitleBar);
    player.addEventListener('pause', displayDefaultTitleBar);

    return () => {
      toggleSongPlayback(false);
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
      player.removeEventListener('play', addSongTitleToTitleBar);
      player.removeEventListener('pause', displayDefaultTitleBar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dispatchCurrentSongTime = () => {
      const playerPositionChange = new CustomEvent('player/positionChange', {
        detail: roundTo(player.currentTime, 2)
      });
      document.dispatchEvent(playerPositionChange);
    };

    const lowResponseIntervalId = setInterval(() => {
      if (!player.paused) dispatchCurrentSongTime();
    }, LOW_RESPONSE_DURATION);

    const pausedResponseIntervalId = setInterval(() => {
      if (player.paused) dispatchCurrentSongTime();
    }, DURATION);

    return () => {
      clearInterval(lowResponseIntervalId);
      clearInterval(pausedResponseIntervalId);
    };
  }, []);

  useEffect(() => {
    // LOCAL STORAGE
    const { playback, preferences, queue } = storage.getAllItems();

    const syncLocalStorage = () => {
      const allItems = storage.getAllItems();
      dispatch({ type: 'UPDATE_LOCAL_STORAGE', data: allItems });

      console.log('local storage updated');
    };

    document.addEventListener('localStorage', syncLocalStorage);

    // if (playback?.volume) {
    //   dispatch({ type: 'UPDATE_VOLUME', data: playback.volume });
    // }

    if (
      store.state.navigationHistory.history.at(-1)?.pageTitle !== preferences?.defaultPageOnStartUp
    )
      changeCurrentActivePage(preferences?.defaultPageOnStartUp);

    toggleShuffling(playback?.isShuffling);
    toggleRepeat(playback?.isRepeating);

    // Restore Smart Shuffle: only set the flag and warm the weight cache. The
    // saved queue is already in its smart order, so we do NOT reshuffle here —
    // that's what made the earlier attempt behave backwards after a restart.
    if (playback?.isTierShuffling) {
      dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: true });
      loadShuffleData().catch((err) => console.error(err));
    }

    window.api.audioLibraryControls
      .checkForStartUpSongs()
      .then((startUpSongData) => {
        if (startUpSongData) playSongFromUnknownSource(startUpSongData, true);
        else if (playback?.currentSong.songId) {
          setStartReason('resume');
          const songId = playback.currentSong.songId;
          // Where it stopped: the small resume key, else what the last quit saved.
          const resumeAt = rememberedPosition(songId) ?? (Number(playback.currentSong.stoppedPosition) || 0);
          // The position can only be set once the engine has the track: `playSong` loads it
          // asynchronously, and a seek before that is dropped (the old code lost it every time).
          Promise.resolve(playSong(songId, false))
            .then(() => {
              if (!(resumeAt > 1)) return;
              const seek = () => {
                const length = player.duration;
                // A song that was over starts again from the top.
                if (Number.isFinite(length) && resumeAt > length - 3) return;
                player.currentTime = resumeAt;
                dispatch({ type: 'UPDATE_SONG_POSITION', data: resumeAt });
                document.dispatchEvent(new CustomEvent('player/positionChange', { detail: resumeAt }));
              };
              if (player.readyState >= 1) seek();
              else player.addEventListener('loadedmetadata', seek, { once: true });
            })
            .catch((err) => console.error(err));
        }
        return undefined;
      })
      .catch((err) => console.error(err));

    if (queue) {
      const updatedQueue = {
        ...store.state.localStorage.queue,
        queue: queue.queue || [],
        queueType: queue.queueType,
        queueId: queue.queueId
      };

      // dispatch({ type: 'UPDATE_QUEUE', data: updatedQueue });
      storage.queue.setQueue(updatedQueue);
    } else {
      window.api.audioLibraryControls
        .getAllSongs()
        .then((audioData) => {
          if (!audioData) return undefined;
          createQueue(
            audioData.data.map((song) => song.songId),
            'songs'
          );
          return undefined;
        })
        .catch((err) => console.error(err));
    }

    return () => {
      document.removeEventListener('localStorage', syncLocalStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncUserData();

    const handleToggleSongPlayback = () => toggleSongPlayback();
    const handleSkipForwardClickListener = () => handleSkipForwardClick('PLAYER_SKIP');
    const handlePlaySongFromUnknownSource = (_: unknown, data: AudioPlayerData) =>
      playSongFromUnknownSource(data, true);

    window.api.unknownSource.playSongFromUnknownSource(handlePlaySongFromUnknownSource);

    window.api.playerControls.toggleSongPlayback(handleToggleSongPlayback);
    window.api.playerControls.skipBackwardToPreviousSong(handleSkipBackwardClick);
    window.api.playerControls.skipForwardToNextSong(handleSkipForwardClickListener);
    return () => {
      window.api.unknownSource.removePlaySongFromUnknownSourceEvent(handleToggleSongPlayback);
      window.api.playerControls.removeTogglePlaybackStateEvent(handleToggleSongPlayback);
      window.api.playerControls.removeSkipBackwardToPreviousSongEvent(handleSkipBackwardClick);
      window.api.playerControls.removeSkipForwardToNextSongEvent(handleSkipForwardClickListener);
      window.api.dataUpdates.removeDataUpdateEventListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const noticeDataUpdateEvents = (_: unknown, dataEvents: DataUpdateEvent[]) => {
      const event = new CustomEvent('app/dataUpdates', { detail: dataEvents });
      document.dispatchEvent(event);
    };

    window.api.dataUpdates.dataUpdateEvent(noticeDataUpdateEvents);

    return () => {
      window.api.dataUpdates.removeDataUpdateEventListeners();
    };
  }, []);

  // app/notifications.ts
  const { addNewNotifications, updateNotifications } = useNotifications(startTransition);

  /**
   * The single answer to "the player refused this track".
   *
   * What it replaces: one repair attempt for one cause, and a modal error
   * dialog for everything else. That dialog is the founding bug's own face -
   * `DEMUXER_ERROR_COULD_NOT_OPEN`, the error this fork exists because of - and
   * showing it again for causes that are NOT that bug, several of which clear
   * themselves within a second, is how a fixed defect came back looking
   * identical. See `playbackRecovery.ts` for the ladder and why it is ordered
   * the way it is; the last rung reports without blocking the app, because a
   * track that will not play is worth a sentence, not a wall.
   */
  const managePlaybackErrors = useCallback(
    (appError: unknown) => {
      const playerErrorData = player.error;
      console.error(appError, playerErrorData);

      const { songId, path: songPath, title } = store.state.currentSongData;
      const key = songId || songPath || 'unknown-source';
      const attempt = playbackRecovery.record(key);
      const action = nextRecoveryAction(playbackRecovery.state(key), playerErrorData?.code);
      const positionBeforeRecovery = player.currentTime;

      const reload = () => {
        if (!player.src) return;
        // A fresh stamp, not a bare load(): the webview can answer load() from
        // its cache with the very response that just failed, which makes every
        // retry look like proof that the file is broken.
        player.src = freshMediaUrl(player.src);
        player.load();
        player.currentTime = positionBeforeRecovery;
      };

      const giveUp = (reason: string) => {
        log(
          'The player could not open a track and every recovery step was spent.',
          { appError, playerErrorData, songPath, attempt, reason },
          'ERROR'
        );
        player.pause();
        addNewNotifications([
          {
            id: 'playbackFailed',
            content: t('notifications.songCouldNotBePlayed', { title: title || songPath || '' }),
            iconName: 'error',
            iconClassName: 'ms-icon'
          }
        ]);
      };

      if (action.step === 'report') {
        giveUp(playerErrorData ? `MediaError code ${playerErrorData.code}` : 'no MediaError');
        return undefined;
      }

      if (action.step === 'retry') {
        log('Retrying a track the player refused.', {
          songPath,
          attempt,
          delayMs: action.delayMs,
          code: playerErrorData?.code
        });
        window.setTimeout(reload, action.delayMs);
        return undefined;
      }

      playbackRecovery.markRepairAttempted(key);
      void window.api.songUpdates
        .healSongForPlayback(songId || songPath)
        .then((repaired) => {
          if (repaired) {
            log('Repaired a track the player refused to open; retrying it.', { songPath });
            reload();
            return undefined;
          }
          // Nothing in the file needed repairing, so the cause is elsewhere -
          // and "elsewhere" very often means the file is not finished arriving.
          // Hand the failure back to the ladder rather than ending here; it has
          // a longer wait left and a bounded number of them.
          log('Nothing to repair in a track the player refused; waiting instead.', { songPath });
          window.setTimeout(reload, 1000);
          return undefined;
        })
        .catch((error: unknown) => {
          // A repair that cannot even read the file is itself evidence: that is
          // what a half-copied track looks like from here. Same treatment - let
          // the ladder spend its remaining wait before anyone is told anything.
          log('Could not repair a track the player refused to open.', { error, songPath }, 'ERROR');
          window.setTimeout(reload, 1000);
        });
      return undefined;
    },
    [addNewNotifications, t]
  );

  // ELO duel invites: listens-driven cadence, surfaced by the persistent dock.
  useDuelInvite();

  const toggleSongPlayback = useCallback(
    (startPlay?: boolean) => {
      if (store.state.currentSongData?.songId) {
        if (typeof startPlay !== 'boolean' || startPlay === player.paused) {
          if (player.readyState > 0) {
            if (player.paused) {
              player
                .play()
                .then(() => {
                  const playbackChange = new CustomEvent('player/playbackChange');
                  return player.dispatchEvent(playbackChange);
                })
                .catch((err) => managePlaybackErrors(err));
              return player.play();
            }
            if (player.ended) {
              player.currentTime = 0;
              player
                .play()
                .then(() => {
                  const playbackChange = new CustomEvent('player/playbackChange');
                  return player.dispatchEvent(playbackChange);
                })
                .catch((err) => managePlaybackErrors(err));
              return player.play();
            }
            const playbackChange = new CustomEvent('player/playbackChange');
            player.dispatchEvent(playbackChange);
            return player.pause();
          }
        }
      } else
        addNewNotifications([
          {
            id: 'noSongToPlay',
            content: t('notifications.selectASongToPlay'),
            iconName: 'error',
            iconClassName: 'ms-icon'
          }
        ]);
      return undefined;
    },
    [addNewNotifications, t, managePlaybackErrors]
  );

  /**
   * One throttle per message code, kept across calls.
   *
   * `throttle(fn, 1000)()` built a NEW throttle on every message and called it
   * immediately, so nothing was ever throttled - a scan pushed one store
   * dispatch and one full re-render per parsed song, and again per generated
   * cover. The throttles are kept per code because a shared one holds a single
   * pending call: parse progress and artwork progress arrive interleaved, and
   * one would keep displacing the other until its bar stopped moving.
   */
  const messageThrottles = useRef(new Map<MessageCodes, (data?: Record<string, unknown>) => void>());

  const displayMessageFromMain = useCallback(
    (_: unknown, messageCode: MessageCodes, data?: Record<string, unknown>) => {
      let show = messageThrottles.current.get(messageCode);
      if (!show) {
        show = throttle((payload?: Record<string, unknown>) => {
          addNewNotifications([parseNotificationFromMain(messageCode, payload)]);
        }, 300);
        messageThrottles.current.set(messageCode, show);
      }
      show(data);
    },
    [addNewNotifications]
  );

  useEffect(() => {
    window.api.messages.getMessageFromMain(displayMessageFromMain);
    return () => {
      window.api.messages.removeMessageToRendererEventListener(displayMessageFromMain);
    };
  }, [displayMessageFromMain]);

  const handleContextMenuVisibilityUpdate = useCallback(() => {
    if (store.state.contextMenuData.isVisible) {
      dispatch({
        type: 'CONTEXT_MENU_VISIBILITY_CHANGE',
        data: false
      });
      store.state.contextMenuData.isVisible = false;
    }
  }, []);

  const addSongTitleToTitleBar = useCallback(() => {
    if (store.state.currentSongData.title && store.state.currentSongData.artists)
      document.title = `${store.state.currentSongData.title} - ${
        Array.isArray(store.state.currentSongData.artists) &&
        store.state.currentSongData.artists.map((artist) => artist.name).join(', ')
      }`;
  }, []);

  const toggleRepeat = useCallback((newState?: RepeatTypes) => {
    const repeatState =
      newState ||
      (store.state.player.isRepeating === 'false'
        ? 'repeat'
        : store.state.player.isRepeating === 'repeat'
          ? 'repeat-1'
          : 'false');

    dispatch({
      type: 'UPDATE_IS_REPEATING_STATE',
      data: repeatState
    });
  }, []);

  const recordRef = useRef<ListeningDataSession>(undefined);
  /** Why the current song is about to stop, set by whatever moves the queue. */
  const endReasonRef = useRef<EndReason>('user_selected');
  /** Why the next song starts: the queue moving on, previous, the restored session; otherwise the
   * user picked it. Read once by the next session, and only for a few seconds: a skip that plays
   * nothing (the end of the queue) must not label the user's next own pick. */
  const startReasonRef = useRef<{ reason: StartReason; at: number }>({ reason: 'user_selected', at: 0 });
  const setStartReason = (reason: StartReason) => {
    startReasonRef.current = { reason, at: performance.now() };
  };

  const recordListeningData = useCallback(
    (songId: string, duration: number, isRepeating = false, isKnownSource = true) => {
      if (recordRef?.current?.songId !== songId || isRepeating) {
        recordRef.current?.stopRecording(endReasonRef.current);
        endReasonRef.current = 'user_selected';
        const pending = startReasonRef.current;
        const startReason = performance.now() - pending.at < 10_000 ? pending.reason : 'user_selected';
        startReasonRef.current = { reason: 'user_selected', at: 0 };

        const listeningDataSession = new ListeningDataSession(
          player,
          songId,
          duration,
          isKnownSource,
          startReason
        );
        listeningDataSession.recordListeningData();
        recordRef.current = listeningDataSession;
      }
    },
    []
  );

  /** Cover light (other/coverLight.ts): the playing cover's tones under the page and the player. */
  const setDynamicThemesFromSongPalette = useCallback(
    (artworkPath?: string) => applyCoverLight(artworkPath),
    []
  );

  // Covers fly from the tile that was clicked into the page it opens (PLAN/14 A2).
  useEffect(() => installSharedCovers(), []);

  // The accent colour the user chose (Settings > Appearance); blue needs no override.
  const accentColor = useStore(store, (state) => state.localStorage.preferences.accentColor);
  useEffect(() => applyAccent(accentColor), [accentColor]);

  // Cover light is on unless the user switched it off (Settings > Appearance).
  const isImageBasedDynamicThemesEnabled = useStore(
    store,
    (state) => !state.localStorage.preferences.isCoverLightDisabled
  );

  useEffect(() => {
    setDynamicThemesFromSongPalette(undefined);
    const resetStyles = setDynamicThemesFromSongPalette(
      isImageBasedDynamicThemesEnabled ? store.state.currentSongData.artworkPath : undefined
    );

    return () => {
      resetStyles();
    };
  }, [isImageBasedDynamicThemesEnabled, setDynamicThemesFromSongPalette]);

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
    [changeQueueCurrentSongIndex, recordListeningData, toggleSongPlayback]
  );

  useEffect(() => {
    let artworkPath: string | undefined;

    const updateMediaSessionMetaData = () => {
      // Windows first: the engine plays, so these controls are the ones Windows sees, and nothing
      // below may keep them from hearing of a change.
      updateSystemMedia(
        store.state.currentSongData,
        {
          duration: player.duration,
          position: player.currentTime,
          playing: !player.paused
        },
        { artist: t('common.unknownArtist'), album: t('common.unknownAlbum') }
      );

      if (store.state.currentSongData.artwork !== undefined) {
        if (typeof store.state.currentSongData.artwork === 'object') {
          const blob = new Blob([store.state.currentSongData.artwork]);
          artworkPath = URL.createObjectURL(blob);
        } else {
          artworkPath = `data:;base64,${store.state.currentSongData.artwork}`;
        }
      } else artworkPath = '';

      navigator.mediaSession.metadata = new MediaMetadata({
        title: store.state.currentSongData.title,
        artist: Array.isArray(store.state.currentSongData.artists)
          ? store.state.currentSongData.artists.map((artist) => artist.name).join(', ')
          : t('common.unknownArtist'),
        album: store.state.currentSongData.album
          ? store.state.currentSongData.album.name || t('common.unknownAlbum')
          : t('common.unknownAlbum'),
        artwork: [
          {
            src: artworkPath,
            sizes: '1000x1000',
            type: 'image/webp'
          }
        ]
      });
      // The engine reports a duration of 0 when a file does not state its length, and
      // setPositionState throws on an unknown duration or a position past it.
      if (Number.isFinite(player.duration) && player.duration > 0)
        navigator.mediaSession.setPositionState({
          duration: player.duration,
          playbackRate: player.playbackRate,
          position: Math.min(player.currentTime, player.duration)
        });
      else navigator.mediaSession.setPositionState(undefined);

      navigator.mediaSession.setActionHandler('pause', () => toggleSongPlayback(false));
      navigator.mediaSession.setActionHandler('play', () => toggleSongPlayback(true));
      navigator.mediaSession.setActionHandler('previoustrack', handleSkipBackwardClick);
      navigator.mediaSession.setActionHandler(`nexttrack`, () =>
        handleSkipForwardClick('PLAYER_SKIP')
      );
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        /* Code excerpted. */
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        /* Code excerpted. */
      });
      navigator.mediaSession.setActionHandler('seekto', () => {
        /* Code excerpted. */
      });
      navigator.mediaSession.playbackState = store.state.player.isCurrentSongPlaying
        ? 'playing'
        : 'paused';
    };

    player.addEventListener('play', updateMediaSessionMetaData);
    player.addEventListener('pause', updateMediaSessionMetaData);
    player.addEventListener('seeked', updateMediaSessionMetaData);
    player.addEventListener('durationchange', updateMediaSessionMetaData);

    return () => {
      if (artworkPath) URL.revokeObjectURL(artworkPath);
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.setPositionState(undefined);
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekto', null);

      player.removeEventListener('play', updateMediaSessionMetaData);
      player.removeEventListener('pause', updateMediaSessionMetaData);
      player.removeEventListener('seeked', updateMediaSessionMetaData);
      player.removeEventListener('durationchange', updateMediaSessionMetaData);
    };
  }, [handleSkipBackwardClick, handleSkipForwardClick, t, toggleSongPlayback]);

  const setDiscordRpcActivity = useCallback(() => {
    if (store.state.currentSongData) {
      const truncateText = (text: string, maxLength: number) => {
        return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
      };
      const title = truncateText(
        store.state.currentSongData?.title ?? t('discordrpc.untitledSong'),
        128
      );
      const artists = truncateText(
        `${store.state.currentSongData.artists?.map((artist) => artist.name).join(', ') || t('discordrpc.unknownArtist')}`,
        128
      );

      const now = Date.now();
      const firstArtistWithArtwork = store.state.currentSongData?.artists?.find(
        (artist) => artist.onlineArtworkPaths !== undefined
      );
      const onlineArtworkLink = firstArtistWithArtwork?.onlineArtworkPaths?.picture_small;
      window.api.playerControls.setDiscordRpcActivity({
        timestamps: {
          start: player.paused ? undefined : now - (player.currentTime ?? 0) * 1000,
          end: player.paused
            ? undefined
            : now + ((player.duration ?? 0) - (player.currentTime ?? 0)) * 1000
        },
        details: title,
        state: artists,
        assets: {
          large_image: 'nemora_logo',
          //large_text: 'Nora', //Large text will also be displayed as the 3rd line (state) so I skipped it for now
          small_image: onlineArtworkLink ?? 'song_artwork',
          small_text: firstArtistWithArtwork
            ? firstArtistWithArtwork.name
            : t('discordrpc.playingASong')
        },
        buttons: [
          {
            label: t('discordrpc.noraOnGitHub'),
            url: 'https://github.com/Nikenmar/Nemora'
          }
        ]
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    player.addEventListener('play', setDiscordRpcActivity);
    player.addEventListener('pause', setDiscordRpcActivity);
    player.addEventListener('seeked', setDiscordRpcActivity);

    return () => {
      player.removeEventListener('play', setDiscordRpcActivity);
      player.removeEventListener('pause', setDiscordRpcActivity);
      player.removeEventListener('seeked', setDiscordRpcActivity);
    };
  }, [setDiscordRpcActivity]);

  const toggleShuffling = useCallback((isShuffling?: boolean) => {
    dispatch({ type: 'TOGGLE_SHUFFLE_STATE', data: isShuffling });
  }, []);

  // Cached per-song weights for the Smart Shuffle, so building a fresh queue can
  // be weighted synchronously (just like the normal shuffle) — fixes the "play a
  // track and it goes linear" bug. Warmed whenever Smart Shuffle turns on.
  // Held by other/smartShuffle.ts, which also applies the session's steering (PLAN/14 C2).
  const tierShuffleDataRef = smartShuffleData;

  useEffect(() => {
    const refreshDuelFeedback = (event: Event) => {
      if (!('detail' in event) || !store.state.player.isTierShuffling) return;
      const updates = (event as DetailAvailableEvent<DataUpdateEvent[]>).detail;
      if (!updates.some(({ dataType }) => dataType === 'eloDuels')) return;
      loadShuffleData().catch((error) => console.error(error));
    };

    document.addEventListener('app/dataUpdates', refreshDuelFeedback);
    return () => document.removeEventListener('app/dataUpdates', refreshDuelFeedback);
  }, []);

  const shuffleQueue = useCallback(
    (songIds: string[], currentSongIndex?: number) => {
      // If Smart Shuffle is on, weight the order instead of pure random. Don't
      // flip the normal-shuffle flag here — the two modes are exclusive.
      if (store.state.player.isTierShuffling) {
        return megaShuffleQueue(songIds, tierShuffleDataRef.current, currentSongIndex);
      }
      toggleShuffling(true);
      return shuffleQueueRandomly(songIds, currentSongIndex);
    },
    [tierShuffleDataRef, toggleShuffling]
  );

  const createQueue = useCallback(
    (
      newQueue: string[],
      queueType: QueueTypes,
      isShuffleQueue = store.state.player.isShuffling || store.state.player.isTierShuffling,
      queueId?: string,
      startPlaying = false
    ) => {
      const queue = {
        currentSongIndex: 0,
        queue: newQueue,
        queueId,
        queueType
      } as Queue;

      if (isShuffleQueue) {
        const { shuffledQueue, positions } = shuffleQueue(queue.queue);
        queue.queue = shuffledQueue;

        if (positions.length > 0) queue.queueBeforeShuffle = positions;
        queue.currentSongIndex = 0;
      } else {
        // A non-shuffled queue was requested: turn BOTH shuffle modes off so Smart
        // Shuffle behaves exactly like the normal one (no "lit button, linear queue").
        toggleShuffling(false);
        if (store.state.player.isTierShuffling)
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
      }

      storage.queue.setQueue(queue);
      // Play buttons of a whole list: the user chose the list, the queue chose its first song.
      if (startPlaying) {
        setStartReason('auto');
        changeQueueCurrentSongIndex(0);
      }
    },
    [changeQueueCurrentSongIndex, shuffleQueue, toggleShuffling]
  );

  // Mega Smart Shuffle (Tierlist Value Shuffle): like the normal shuffle, but it
  // weighted-reorders the CURRENT queue (keeping the playing track up front) so
  // you stay in the same context (all songs / a playlist) — it just leans the
  // upcoming tracks toward what you rate highly. Mutually exclusive with shuffle.
  const toggleTierShuffle = useCallback(
    (force?: boolean) => {
      const next = force ?? !store.state.player.isTierShuffling;

      if (!next) {
        const wasOn = store.state.player.isTierShuffling;
        dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
        // Restore the original order, exactly like turning the normal shuffle off.
        const q = store.state.localStorage.queue;
        if (wasOn && Array.isArray(q.queueBeforeShuffle) && q.queueBeforeShuffle.length > 0) {
          const playing = q.queue[q.currentSongIndex ?? 0];
          const restored = q.queueBeforeShuffle.map((pos) => q.queue[pos]);
          storage.queue.setQueue({
            ...q,
            queue: restored,
            queueBeforeShuffle: [],
            currentSongIndex: playing ? restored.indexOf(playing) : (q.currentSongIndex ?? 0)
          });
        }
        return;
      }

      const currentQueue = store.state.localStorage.queue;
      const baseQueue = [...currentQueue.queue];
      if (baseQueue.length === 0) {
        addNewNotifications([
          { id: 'tierShuffleEmpty', duration: 5000, content: t('player.tierShuffleEmpty') }
        ]);
        return;
      }

      const trace = startTrace('Smart Shuffle on');
      window.api.tierlistsData
        .getTierlistData()
        .then((tierlists) => {
          trace.step('tierlists');
          const hasInfluencing = (tierlists || []).some((tl) => tl.influencesShuffle);
          if (!hasInfluencing) {
            // No tierlist feeds the shuffle — don't enable, just tell the user.
            addNewNotifications([
              {
                id: 'tierShuffleNoInfluence',
                duration: 6000,
                content: t('player.tierShuffleNoInfluence')
              }
            ]);
            return null;
          }
          // Weights for the WHOLE library, so later queue rebuilds stay smart too.
          return loadShuffleData();
        })
        .then((data) => {
          if (!data) return; // aborted (no influencing tierlists)
          trace.step('weights');
          const { shuffledQueue, positions } = megaShuffleQueue(
            baseQueue,
            data,
            currentQueue.currentSongIndex ?? undefined
          );
          trace.step('order');
          storage.queue.setQueue({
            ...currentQueue,
            queue: shuffledQueue,
            queueBeforeShuffle: positions,
            currentSongIndex: 0
          });
          trace.step('queue');
          toggleShuffling(false); // mutual exclusivity with the normal shuffle
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: true });
          trace.step('state');
          // No playSong() call — the current track keeps playing seamlessly.
          addNewNotifications([
            { id: 'tierShuffleOn', duration: 4000, content: t('player.tierShuffleOn') }
          ]);
          trace.step('toast');
          void trace.end({ queue: baseQueue.length });
        })
        .catch((err) => console.error(err));
    },
    [addNewNotifications, t, toggleShuffling]
  );

  const updateQueueData = useCallback(
    (
      currentSongIndex?: number | null,
      newQueue?: string[],
      isShuffleQueue = false,
      playCurrentSongIndex = true,
      restoreAndClearPreviousQueue = false
    ) => {
      const currentQueue = store.state.localStorage.queue;
      const queue: Queue = {
        ...currentQueue,
        currentSongIndex:
          typeof currentSongIndex === 'number' || currentSongIndex === null
            ? currentSongIndex
            : currentQueue.currentSongIndex,
        queue: newQueue ?? currentQueue.queue
      };

      if (
        restoreAndClearPreviousQueue &&
        Array.isArray(queue.queueBeforeShuffle) &&
        queue.queueBeforeShuffle.length > 0
      ) {
        const currentQueuePlayingSong = queue.queue.at(currentQueue.currentSongIndex ?? 0);
        const restoredQueue: string[] = [];

        for (let i = 0; i < queue.queueBeforeShuffle.length; i += 1) {
          restoredQueue.push(queue.queue[queue.queueBeforeShuffle[i]]);
        }

        queue.queue = restoredQueue;
        queue.queueBeforeShuffle = [];
        if (currentQueuePlayingSong)
          queue.currentSongIndex = queue.queue.indexOf(currentQueuePlayingSong);
      }

      if (queue.queue.length > 1 && isShuffleQueue) {
        // toggleShuffling will be called in the shuffleQueue function
        const { shuffledQueue, positions } = shuffleQueue(
          // Clone the songIds array because tanstack store thinks its values aren't changed if we don't do this
          [...queue.queue],
          queue.currentSongIndex ?? currentQueue.currentSongIndex ?? undefined
        );
        queue.queue = shuffledQueue;
        if (positions.length > 0) queue.queueBeforeShuffle = positions;
        queue.currentSongIndex = 0;
      } else {
        // A non-shuffled queue was requested: turn BOTH shuffle modes off so Smart
        // Shuffle behaves exactly like the normal one (no "lit button, linear queue").
        toggleShuffling(false);
        if (store.state.player.isTierShuffling)
          dispatch({ type: 'TOGGLE_TIER_SHUFFLE_STATE', data: false });
      }

      storage.queue.setQueue(queue);
      if (playCurrentSongIndex && typeof currentSongIndex === 'number')
        playSong(currentQueue.queue[currentSongIndex]);
    },
    [playSong, shuffleQueue, toggleShuffling]
  );

  const updateCurrentSongPlaybackState = useCallback((isPlaying: boolean) => {
    if (isPlaying !== store.state.player.isCurrentSongPlaying)
      dispatch({ type: 'CURRENT_SONG_PLAYBACK_STATE', data: isPlaying });
  }, []);

  const updateContextMenuData = useCallback(
    (
      isVisible: boolean,
      menuItems: ContextMenuItem[] = [],
      pageX?: number,
      pageY?: number,
      contextMenuData?: ContextMenuAdditionalData
    ) => {
      const menuData: ContextMenuData = {
        isVisible,
        data: contextMenuData,
        menuItems: menuItems.length > 0 ? menuItems : store.state.contextMenuData.menuItems,
        pageX: pageX !== undefined ? pageX : store.state.contextMenuData.pageX,
        pageY: pageY !== undefined ? pageY : store.state.contextMenuData.pageY
      };

      dispatch({
        type: 'CONTEXT_MENU_DATA_CHANGE',
        data: menuData
      });
    },
    []
  );

  const updateBodyBackgroundImage = useCallback((isVisible: boolean, src?: string) => {
    let image: string | undefined;
    const disableBackgroundArtworks = storage.preferences.getPreferences(
      'disableBackgroundArtworks'
    );

    if (!disableBackgroundArtworks && isVisible && src) image = src;

    return dispatch({
      type: 'UPDATE_BODY_BACKGROUND_IMAGE',
      data: image
    });
  }, []);

  const updateCurrentlyActivePageData = useCallback(
    (callback: (currentPageData: PageData) => PageData) => {
      const { navigationHistory } = store.state;
      const updatedData = callback(
        navigationHistory.history[navigationHistory.pageHistoryIndex].data ?? {
          scrollTopOffset: 0
        }
      );
      dispatch({
        type: 'CURRENT_ACTIVE_PAGE_DATA_UPDATE',
        data: updatedData
      });
    },
    []
  );

  const updatePageHistoryIndex = useCallback((type: 'increment' | 'decrement' | 'home') => {
    const { history, pageHistoryIndex } = store.state.navigationHistory;
    if (type === 'decrement' && pageHistoryIndex - 1 >= 0) {
      const newPageHistoryIndex = pageHistoryIndex - 1;
      const data = {
        pageHistoryIndex: newPageHistoryIndex,
        history
      } as NavigationHistoryData;

      return withViewTransition(
        () => dispatch({ type: 'UPDATE_NAVIGATION_HISTORY', data }),
        'back'
      );
    }
    if (type === 'increment' && pageHistoryIndex + 1 < history.length) {
      const newPageHistoryIndex = pageHistoryIndex + 1;
      const data = {
        pageHistoryIndex: newPageHistoryIndex,
        history
      } as NavigationHistoryData;

      return withViewTransition(
        () => dispatch({ type: 'UPDATE_NAVIGATION_HISTORY', data }),
        'forward'
      );
    }
    if (type === 'home') {
      const data: NavigationHistoryData = {
        history: [{ pageTitle: 'Home' }],
        pageHistoryIndex: 0
      };

      return withViewTransition(
        () => dispatch({ type: 'UPDATE_NAVIGATION_HISTORY', data }),
        'back'
      );
    }
    return undefined;
  }, []);

  const updatePromptMenuHistoryIndex = useCallback((type: 'increment' | 'decrement' | 'home') => {
    const { prompts, currentActiveIndex } = store.state.promptMenuNavigationData;
    if (type === 'decrement' && currentActiveIndex - 1 >= 0) {
      const newPageHistoryIndex = currentActiveIndex - 1;
      const data = {
        isVisible: true,
        currentActiveIndex: newPageHistoryIndex,
        prompts
      };

      return dispatch({
        type: 'PROMPT_MENU_DATA_CHANGE',
        data
      });
    }
    if (type === 'increment' && currentActiveIndex + 1 < prompts.length) {
      const newPageHistoryIndex = currentActiveIndex + 1;
      const data = {
        isVisible: true,
        currentActiveIndex: newPageHistoryIndex,
        prompts
      };

      return dispatch({
        type: 'PROMPT_MENU_DATA_CHANGE',
        data
      });
    }
    return undefined;
  }, []);

  const updateMultipleSelections = useCallback(
    (id: string, selectionType: QueueTypes, type: 'add' | 'remove') => {
      if (
        store.state.multipleSelectionsData.selectionType &&
        selectionType !== store.state.multipleSelectionsData.selectionType
      )
        return;
      let { multipleSelections } = store.state.multipleSelectionsData;
      if (type === 'add') {
        if (multipleSelections.includes(id)) return;
        multipleSelections.push(id);
      } else if (type === 'remove') {
        if (!multipleSelections.includes(id)) return;
        multipleSelections = multipleSelections.filter((selection) => selection !== id);
      }

      dispatch({
        type: 'UPDATE_MULTIPLE_SELECTIONS_DATA',
        data: {
          ...store.state.multipleSelectionsData,
          selectionType,
          multipleSelections: [...multipleSelections]
        } as MultipleSelectionData
      });
    },
    []
  );

  const toggleMultipleSelections = useCallback(
    (
      isEnabled?: boolean,
      selectionType?: QueueTypes,
      addSelections?: string[],
      replaceSelections = false
    ) => {
      const updatedSelectionData = store.state.multipleSelectionsData;

      if (typeof isEnabled === 'boolean') {
        // Selection now survives navigation — never mix id kinds: switching the
        // selection type drops the previous selection instead of merging into it.
        if (
          selectionType !== updatedSelectionData.selectionType &&
          updatedSelectionData.selectionType !== undefined
        )
          updatedSelectionData.multipleSelections = [];
        updatedSelectionData.selectionType = selectionType;

        if (Array.isArray(addSelections) && isEnabled === true)
          if (replaceSelections) {
            updatedSelectionData.multipleSelections = addSelections;
          } else updatedSelectionData.multipleSelections.push(...addSelections);

        if (isEnabled === false) {
          updatedSelectionData.multipleSelections = [];
          updatedSelectionData.selectionType = undefined;
        }
        updatedSelectionData.isEnabled = isEnabled;

        dispatch({
          type: 'UPDATE_MULTIPLE_SELECTIONS_DATA',
          data: {
            ...updatedSelectionData
          } as MultipleSelectionData
        });
      }
    },
    []
  );

  const changeCurrentActivePage = useCallback(
    (pageClass: PageTitles, data?: PageData) => {
      const navigationHistory = { ...store.state.navigationHistory };
      const { pageTitle, onPageChange } =
        navigationHistory.history[navigationHistory.pageHistoryIndex];

      const currentPageData = navigationHistory.history[navigationHistory.pageHistoryIndex].data;
      if (
        pageTitle !== pageClass ||
        (currentPageData && data && isDataChanged(currentPageData, data))
      ) {
        if (onPageChange) onPageChange(pageClass, data);

        const pageData = {
          pageTitle: pageClass,
          data
        };

        navigationHistory.history = navigationHistory.history.slice(
          0,
          navigationHistory.pageHistoryIndex + 1
        );
        navigationHistory.history.push(pageData);
        navigationHistory.pageHistoryIndex += 1;

        log(`User navigated to '${pageClass}'`);

        withViewTransition(
          () => dispatch({ type: 'UPDATE_NAVIGATION_HISTORY', data: navigationHistory }),
          'forward'
        );
      } else
        addNewNotifications([
          {
            content: t('notifications.alreadyInPage'),
            iconName: 'info',
            iconClassName: 'ms-icon',
            id: 'alreadyInCurrentPage',
            duration: 2500
          }
        ]);
    },
    [addNewNotifications, t]
  );

  const updatePlayerType = useCallback((type: PlayerTypes) => {
    const from = store.state.playerType;
    if (from === type) return;
    const update = () => dispatch({ type: 'UPDATE_PLAYER_TYPE', data: type });
    // Into and out of the full-screen player the cover travels between the two views; the mini
    // player resizes the native window, which no view transition can follow.
    if (from !== 'mini' && type !== 'mini') withViewTransition(update, 'none', 'player', ['player-cover']);
    else update();
  }, []);

  const toggleIsFavorite = useCallback(
    (isFavorite?: boolean, onlyChangeCurrentSongData = false) => {
      toggleSongIsFavorite(
        store.state.currentSongData.songId,
        store.state.currentSongData.isAFavorite,
        isFavorite,
        onlyChangeCurrentSongData
      )
        .then((newFavorite) => {
          if (typeof newFavorite === 'boolean') {
            store.state.currentSongData.isAFavorite = newFavorite;
            return dispatch({
              type: 'TOGGLE_IS_FAVORITE_STATE',
              data: newFavorite
            });
          }
          return undefined;
        })
        .catch((err) => console.error(err));
    },
    []
  );

  const updateVolume = useCallback((volume: number) => {
    storage.playback.setVolumeOptions('value', volume);

    dispatch({
      type: 'UPDATE_VOLUME_VALUE',
      data: volume
    });
  }, []);

  const updateSongPosition = useCallback((position: number) => {
    if (position >= 0 && position <= player.duration) player.currentTime = position;
  }, []);

  useEffect(
    () =>
      registerBenchApp({
        changeCurrentActivePage,
        playSong,
        createQueue,
        updateSongPosition,
        currentSongId: () => store.state.currentSongData?.songId
      }),
    [changeCurrentActivePage, playSong, createQueue, updateSongPosition]
  );

  const toggleMutedState = useCallback((isMute?: boolean) => {
    if (isMute !== undefined) {
      if (isMute !== store.state.player.volume.isMuted) {
        dispatch({ type: 'UPDATE_MUTED_STATE', data: isMute });
      }
    } else {
      dispatch({ type: 'UPDATE_MUTED_STATE' });
    }
  }, []);

  useEffect(
    () =>
      registerShots({
        changeCurrentActivePage,
        changePromptMenuData,
        updatePlayerType,
        addNewNotifications,
        toggleMutedState,
        playSong,
        createQueue,
        updateSongPosition,
        togglePlay: toggleSongPlayback,
        currentPage: () =>
          store.state.navigationHistory.history[store.state.navigationHistory.pageHistoryIndex]
            .pageTitle
      }),
    [
      changeCurrentActivePage,
      changePromptMenuData,
      updatePlayerType,
      addNewNotifications,
      toggleMutedState,
      playSong,
      createQueue,
      updateSongPosition,
      toggleSongPlayback
    ]
  );

  const manageKeyboardShortcuts = useCallback(
    (e: KeyboardEvent) =>
      handleKeyboardShortcut(e, {
        updateVolume,
        toggleMutedState,
        handleSkipForwardClick,
        handleSkipBackwardClick,
        toggleShuffling,
        toggleRepeat,
        toggleIsFavorite,
        updatePlayerType,
        changeCurrentActivePage,
        changePromptMenuData,
        toggleMultipleSelections,
        toggleSongPlayback,
        updatePageHistoryIndex,
        addNewNotifications,
        t
      }),
    [

      updateVolume,
      toggleMutedState,
      handleSkipForwardClick,
      handleSkipBackwardClick,
      toggleShuffling,
      toggleRepeat,
      toggleIsFavorite,
      updatePlayerType,
      changeCurrentActivePage,
      changePromptMenuData,
      toggleMultipleSelections,
      toggleSongPlayback,
      updatePageHistoryIndex,
      addNewNotifications,
      t
    ]
  );

  useEffect(() => {
    window.addEventListener('click', handleContextMenuVisibilityUpdate);
    window.addEventListener('keydown', manageKeyboardShortcuts);
    return () => {
      window.removeEventListener('click', handleContextMenuVisibilityUpdate);
      window.removeEventListener('keydown', manageKeyboardShortcuts);
    };
  }, [handleContextMenuVisibilityUpdate, manageKeyboardShortcuts]);

  const updateUserData = useCallback(
    async (callback: (prevState: UserData) => UserData | Promise<UserData> | void) => {
      try {
        const updatedUserData = await callback(store.state.userData);

        if (typeof updatedUserData === 'object') {
          dispatch({ type: 'USER_DATA_CHANGE', data: updatedUserData });
        }
      } catch (error) {
        console.error(error);
      }
    },
    []
  );

  const fetchUserData = useCallback(
    () =>
      window.api.userData
        .getUserData()
        .then((res) => updateUserData(() => res))
        .catch((err) => console.error(err)),
    [updateUserData]
  );

  useEffect(() => {
    fetchUserData();
    const manageUserDataUpdates = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (event.dataType.includes('userData') || event.dataType === 'settings/preferences')
            fetchUserData();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageUserDataUpdates);
    return () => {
      document.removeEventListener('app/dataUpdates', manageUserDataUpdates);
    };
  }, [fetchUserData]);

  const onSongDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      console.log(e.dataTransfer.files);
      if (e.dataTransfer.files.length > 0) {
        // `path` exists only under Electron; WebView2 leaves it undefined and
        // supplies real paths through the Tauri drag-drop event instead.
        const droppedPath = e.dataTransfer.files[0].path;
        const isASupportedAudioFormat =
          droppedPath !== undefined &&
          appPreferences.supportedMusicExtensions.some((type) => droppedPath.endsWith(type));

        if (isASupportedAudioFormat) fetchSongFromUnknownSource(droppedPath);
        else
          changePromptMenuData(
            true,
            <UnsupportedFileMessagePrompt
              filePath={e.dataTransfer.files[0].path || e.dataTransfer.files[0].name}
            />
          );
      }
      if (AppRef.current) AppRef.current.classList.remove('song-drop');
    },
    [changePromptMenuData, fetchSongFromUnknownSource]
  );

  const updateCurrentSongData = useCallback(
    (callback: (prevData: AudioPlayerData) => AudioPlayerData) => {
      const updatedData = callback(store.state.currentSongData);
      if (updatedData) {
        dispatch({ type: 'CURRENT_SONG_DATA_CHANGE', data: updatedData });
      }
    },
    []
  );

  const clearAudioPlayerData = useCallback(() => {
    toggleSongPlayback(false);

    player.currentTime = 0;
    player.pause();

    const updatedQueue = store.state.localStorage.queue.queue.filter(
      (songId) => songId !== store.state.currentSongData.songId
    );
    updateQueueData(null, updatedQueue);

    dispatch({ type: 'CURRENT_SONG_DATA_CHANGE', data: {} as AudioPlayerData });

    addNewNotifications([
      {
        id: 'songPausedOnDelete',
        duration: 7500,
        content: t('notifications.playbackPausedDueToSongDeletion')
      }
    ]);
  }, [addNewNotifications, t, toggleSongPlayback, updateQueueData]);

  const updateEqualizerOptions = useCallback((options: Equalizer) => {
    storage.equalizerPreset.setEqualizerPreset(options);
  }, []);

  const changeUpNextSongData = useCallback((upNextSongData?: AudioPlayerData) => {
    dispatch({ type: 'UP_NEXT_SONG_DATA_CHANGE', data: upNextSongData });
  }, []);

  const appUpdateContextValues: AppUpdateContextType = useMemo(
    () => ({
      updateUserData,
      updateCurrentSongData,
      updateContextMenuData,
      changePromptMenuData,
      changeUpNextSongData,
      updatePromptMenuHistoryIndex,
      playSong,
      changeCurrentActivePage,
      updateCurrentlyActivePageData,
      addNewNotifications,
      updateNotifications,
      createQueue,
      updatePageHistoryIndex,
      changeQueueCurrentSongIndex,
      updateCurrentSongPlaybackState,
      updatePlayerType,
      handleSkipBackwardClick,
      handleSkipForwardClick,
      updateSongPosition,
      updateVolume,
      toggleMutedState,
      toggleRepeat,
      toggleShuffling,
      toggleTierShuffle,
      toggleIsFavorite,
      toggleSongPlayback,
      updateQueueData,
      clearAudioPlayerData,
      updateBodyBackgroundImage,
      updateMultipleSelections,
      toggleMultipleSelections,
      updateEqualizerOptions
    }),
    [
      updateUserData,
      updateCurrentSongData,
      updateContextMenuData,
      changePromptMenuData,
      changeUpNextSongData,
      updatePromptMenuHistoryIndex,
      playSong,
      changeCurrentActivePage,
      updateCurrentlyActivePageData,
      addNewNotifications,
      updateNotifications,
      createQueue,
      updatePageHistoryIndex,
      changeQueueCurrentSongIndex,
      updateCurrentSongPlaybackState,
      updatePlayerType,
      handleSkipBackwardClick,
      handleSkipForwardClick,
      updateSongPosition,
      updateVolume,
      toggleMutedState,
      toggleRepeat,
      toggleShuffling,
      toggleTierShuffle,
      toggleIsFavorite,
      toggleSongPlayback,
      updateQueueData,
      clearAudioPlayerData,
      updateBodyBackgroundImage,
      updateMultipleSelections,
      toggleMultipleSelections,
      updateEqualizerOptions
    ]
  );

  const isReducedMotion = useStore(store, (state) => {
    storeRef.current = state;

    return (
      state.localStorage.preferences.isReducedMotion ||
      (state.isOnBatteryPower && state.localStorage.preferences.removeAnimationsOnBatteryPower)
    );
  });
  const isDarkMode = useStore(store, (state) => state.isDarkMode);
  const playerType = useStore(store, (state) => state.playerType);
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  useEffect(() => {
    if (isDarkMode) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
  }, [isDarkMode]);

  // On body too, so tooltips, portalled dialogs and every player type stop moving with the app.
  useEffect(() => {
    document.body.classList.toggle('reduced-motion', !!isReducedMotion);
  }, [isReducedMotion]);

  return (
    <ErrorBoundary>
      <AppUpdateContext.Provider value={appUpdateContextValues}>
        {playerType === 'normal' ? (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the app root takes drops and the window-wide keys; it is not a control
          <div
            className={`App select-none ${
              isDarkMode ? 'dark bg-chrome' : 'bg-chrome'
            } ${
              isReducedMotion
                ? 'reduced-motion animate-none transition-none !delay-0 !duration-[0] [&.dialog-menu]:!backdrop-blur-none'
                : ''
            } grid !h-screen w-full grid-rows-[auto_1fr_auto] items-center overflow-y-hidden after:invisible after:absolute after:-z-10 after:grid after:h-full after:w-full after:place-items-center after:bg-shade/0 after:text-4xl after:font-medium after:text-on-media after:content-["Drop_your_song_here"] [&.blurred_#title-bar]:opacity-40 [&.fullscreen_#window-controls-container]:hidden [&.song-drop]:after:visible [&.song-drop]:after:z-20 [&.song-drop]:after:border-4 [&.song-drop]:after:border-dashed [&.song-drop]:after:border-ink-dim [&.song-drop]:after:bg-shade/70 [&.song-drop]:after:transition-[background,visibility,color] `}
            ref={AppRef}
            onDragEnter={addSongDropPlaceholder}
            onDragLeave={removeSongDropPlaceholder}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={onSongDrop}
          >
            <Preloader />
            {bodyBackgroundImage && (
              <div
                className={`body-background-image-container absolute h-full w-full overflow-hidden !bg-canvas bg-center`}
              >
                <Img
                  className={`w-full bg-cover opacity-100 blur-0 brightness-100 transition-[filter,opacity] duration-500 ${
                    bodyBackgroundImage &&
                    '!opacity-100 !blur-[1.5rem] !brightness-[.55]'
                  }`}
                  loading="eager"
                  src={bodyBackgroundImage}
                  alt=""
                />
              </div>
            )}
            <ContextMenu />
            <PromptMenu />
            <TitleBar />
            <BodyAndSideBarContainer />
            <SongControlsContainer />
          </div>
        ) : (
          <ErrorBoundary>
            {playerType === 'mini' ? (
              <Suspense fallback={<SuspenseLoader />}>
                <MiniPlayer
                  className={`${
                    isReducedMotion
                      ? 'reduced-motion animate-none transition-none !duration-[0] [&.dialog-menu]:!backdrop-blur-none'
                      : ''
                  }`}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<SuspenseLoader />}>
                <FullScreenPlayer />
              </Suspense>
            )}
          </ErrorBoundary>
        )}
        <TooltipLayer />
      </AppUpdateContext.Provider>
    </ErrorBoundary>
  );
}
