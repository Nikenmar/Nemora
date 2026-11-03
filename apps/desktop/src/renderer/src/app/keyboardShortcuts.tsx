// PLAN/21 P21.5: moved from App.tsx as it was. The app's keyboard shortcuts; App passes its own
// handlers and calls this from its window keydown listener.
import type { TFunction } from 'i18next';

import type { AppUpdateContextType } from '../contexts/AppUpdateContext';
import storage from '../utils/localStorage';
import { store } from '../store';
import { player } from './bootstrap';
import { AppShortcutsPrompt } from './lazyScreens';

/** App's own handlers; two take their first argument as optional, which the context's types do not say. */
export type ShortcutHandlers = Omit<Pick<
  AppUpdateContextType,
  | 'updateVolume'
  | 'toggleMutedState'
  | 'handleSkipForwardClick'
  | 'handleSkipBackwardClick'
  | 'toggleShuffling'
  | 'toggleRepeat'
  | 'toggleIsFavorite'
  | 'updatePlayerType'
  | 'changeCurrentActivePage'
  | 'changePromptMenuData'
  | 'toggleMultipleSelections'
  | 'toggleSongPlayback'
  | 'updatePageHistoryIndex'
  | 'addNewNotifications'
>, 'handleSkipForwardClick' | 'toggleIsFavorite'> & {
  handleSkipForwardClick: (reason?: SongSkipReason) => void;
  toggleIsFavorite: (isFavorite?: boolean, onlyChangeCurrentSongData?: boolean) => void;
  t: TFunction;
};

export const handleKeyboardShortcut = (e: KeyboardEvent, handlers: ShortcutHandlers) => {
  const {
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
  } = handlers;
  const ctrlCombinations = [
    'ArrowUp',
    'ArrowDown',
    'ArrowRight',
    'ArrowLeft',
    'm',
    's',
    't',
    'h',
    'l',
    'n',
    'q',
    'f',
    '[',
    ']',
    '\\',
    '/'
  ];
  const shiftCombinations = ['ArrowRight', 'ArrowLeft'];
  const altCombinations = ['ArrowRight', 'ArrowLeft', 'Home'];
  const functionCombinations = ['F12', 'F5'];
  // Typing in a field keeps its keys: Space is a space there, Shift+arrows select text. Only
  // Ctrl and Alt combinations and the function keys still reach the app.
  const target = e.target as HTMLElement | null;
  const isTyping =
    !!target?.closest('input, textarea, select, [contenteditable="true"]') &&
    !(target instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'button'].includes(target.type));
  if (isTyping && !e.ctrlKey && !e.altKey && !functionCombinations.includes(e.key)) return;
  // A modal window (a game, a prompt) owns its plain keys: Space there never plays the song.
  if (document.querySelector('dialog[open]') && !e.ctrlKey && !e.altKey && !functionCombinations.includes(e.key))
    return;
  if (
    (e.ctrlKey && ctrlCombinations.some((x) => e.key === x)) ||
    (e.shiftKey && shiftCombinations.some((x) => e.key === x)) ||
    (e.altKey && altCombinations.some((x) => e.key === x)) ||
    functionCombinations.some((x) => e.key === x) ||
    e.code === 'Space'
  )
    e.preventDefault();

  // ctrl combinations
  if (e.ctrlKey && e.key === 'ArrowUp')
    updateVolume(player.volume + 0.05 <= 1 ? player.volume * 100 + 5 : 100);
  else if (e.ctrlKey && e.key === 'ArrowDown')
    updateVolume(player.volume - 0.05 >= 0 ? player.volume * 100 - 5 : 0);
  else if (e.ctrlKey && e.key === 'm') toggleMutedState(!store.state.player.volume.isMuted);
  else if (e.ctrlKey && e.key === 'ArrowRight') handleSkipForwardClick();
  else if (e.ctrlKey && e.key === 'ArrowLeft') handleSkipBackwardClick();
  else if (e.ctrlKey && e.key === 's') toggleShuffling();
  else if (e.ctrlKey && e.key === 't') toggleRepeat();
  else if (e.ctrlKey && e.key === 'h') toggleIsFavorite();
  else if (e.ctrlKey && e.key === 'y') window.api.theme.changeAppTheme();
  else if (e.ctrlKey && e.key === 'l') {
    const currentlyActivePage =
      store.state.navigationHistory.history[store.state.navigationHistory.pageHistoryIndex];
    // Leaving Lyrics goes back to the page it was opened from, as the player's lyrics button does.
    if (currentlyActivePage.pageTitle !== 'Lyrics') changeCurrentActivePage('Lyrics');
    else if (store.state.navigationHistory.pageHistoryIndex > 0) updatePageHistoryIndex('decrement');
    else changeCurrentActivePage('Home');
  } else if (e.ctrlKey && e.key === 'n')
    updatePlayerType(store.state.playerType === 'mini' ? 'normal' : 'mini');
  else if (e.ctrlKey && e.key === 'q') {
    const currentlyActivePage =
      store.state.navigationHistory.history[store.state.navigationHistory.pageHistoryIndex];
    if (currentlyActivePage.pageTitle !== 'CurrentQueue') changeCurrentActivePage('CurrentQueue');
    // Leaving the queue goes back to the page it was opened from, as Lyrics does.
    else if (store.state.navigationHistory.pageHistoryIndex > 0) updatePageHistoryIndex('decrement');
    else changeCurrentActivePage('Home');
  } else if (e.ctrlKey && e.key === 'f') changeCurrentActivePage('Search');
  else if (e.ctrlKey && e.key === ']') {
    let updatedPlaybackRate = store.state.localStorage.playback.playbackRate || 1;

    if (updatedPlaybackRate + 0.05 > 4) updatedPlaybackRate = 4;
    else updatedPlaybackRate += 0.05;

    updatedPlaybackRate = parseFloat(updatedPlaybackRate.toFixed(2));

    storage.setItem('playback', 'playbackRate', updatedPlaybackRate);
    addNewNotifications([
      {
        id: 'playbackRate',
        iconName: 'avg_pace',
        content: t('notifications.playbackRateChanged', {
          val: updatedPlaybackRate
        })
      }
    ]);
  } else if (e.ctrlKey && e.key === '[') {
    let updatedPlaybackRate = store.state.localStorage.playback.playbackRate || 1;

    if (updatedPlaybackRate - 0.05 < 0.25) updatedPlaybackRate = 0.25;
    else updatedPlaybackRate -= 0.05;

    updatedPlaybackRate = parseFloat(updatedPlaybackRate.toFixed(2));

    storage.setItem('playback', 'playbackRate', updatedPlaybackRate);
    addNewNotifications([
      {
        id: 'playbackRate',
        iconName: 'avg_pace',
        content: t('notifications.playbackRateChanged', {
          val: updatedPlaybackRate
        })
      }
    ]);
  } else if (e.ctrlKey && e.key === '\\') {
    storage.setItem('playback', 'playbackRate', 1);
    addNewNotifications([
      {
        id: 'playbackRate',
        iconName: 'avg_pace',
        content: t('notifications.playbackRateReset')
      }
    ]);
  } else if (e.ctrlKey && e.key === '/') changePromptMenuData(true, <AppShortcutsPrompt />);
  // default combinations
  else if (e.code === 'Escape') toggleMultipleSelections(false);
  else if (e.code === 'Space') toggleSongPlayback();
  // shift combinations
  else if (e.shiftKey && e.key === 'ArrowLeft') {
    if (player.currentTime - 10 >= 0) player.currentTime -= 10;
    else player.currentTime = 0;
  } else if (e.shiftKey && e.key === 'ArrowRight') {
    if (player.currentTime + 10 < player.duration) player.currentTime += 10;
  }
  // alt combinations
  else if (e.altKey && e.key === 'Home') updatePageHistoryIndex('home');
  else if (e.altKey && e.key === 'ArrowLeft') updatePageHistoryIndex('decrement');
  else if (e.altKey && e.key === 'ArrowRight') updatePageHistoryIndex('increment');
  // function key combinations
  else if (e.key === 'F5') {
    e.preventDefault();
    window.api.appControls.restartRenderer(`User request through F5.`);
  } else if (e.key === 'F12' && !window.api.properties.isInDevelopment)
    window.api.settingsHelpers.openDevtools();
};
