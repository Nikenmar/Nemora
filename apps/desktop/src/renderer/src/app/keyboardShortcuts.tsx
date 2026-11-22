// PLAN/21 P21.5: moved from App.tsx as it was. The app's keyboard shortcuts; App passes its own
// handlers and calls this from its window keydown listener.
import type { TFunction } from 'i18next';

import type { AppUpdateContextType } from '../contexts/AppUpdateContext';
import storage from '../utils/localStorage';
import { isTypingIn, shortcutKey } from '../utils/shortcutKey';
import { store } from '../store';
import { FOCUS_SEARCH_EVENT } from '../components/TitleBar/TitleBarSearch';
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
    'k',
    '[',
    ']',
    '\\',
    '/'
  ];
  const shiftCombinations = ['ArrowRight', 'ArrowLeft'];
  const altCombinations = ['ArrowRight', 'ArrowLeft', 'Home'];
  const functionCombinations = ['F12', 'F5'];
  // With Ctrl, the keys a text field edits with.
  const textEditingKeys = [
    ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Backspace', 'Delete'],
    ...['a', 'c', 'v', 'x', 'y', 'z']
  ];
  // Typing in a field keeps its keys: Space is a space there, Shift+arrows select text. Only
  // Ctrl and Alt combinations and the function keys still reach the app.
  const isTyping = isTypingIn(e.target);
  if (isTyping && !e.ctrlKey && !e.altKey && !functionCombinations.includes(e.key)) return;
  // Whatever the layout: Ctrl+A on a Russian one says `ф` (utils/shortcutKey).
  const key = shortcutKey(e);
  // The field's own editing keys stay the field's: Ctrl+arrows move and select by word (they skip
  // songs and set the volume elsewhere), Ctrl+Y redoes (it changes the theme elsewhere).
  if (isTyping && e.ctrlKey && textEditingKeys.includes(key)) return;
  // A modal window (a game, a prompt) owns its plain keys: Space there never plays the song.
  if (document.querySelector('dialog[open]') && !e.ctrlKey && !e.altKey && !functionCombinations.includes(e.key))
    return;
  if (
    (e.ctrlKey && ctrlCombinations.some((x) => key === x)) ||
    (e.shiftKey && shiftCombinations.some((x) => e.key === x)) ||
    (e.altKey && altCombinations.some((x) => e.key === x)) ||
    functionCombinations.some((x) => e.key === x) ||
    e.code === 'Space'
  )
    e.preventDefault();

  // ctrl combinations
  if (e.ctrlKey && key === 'ArrowUp')
    updateVolume(player.volume + 0.05 <= 1 ? player.volume * 100 + 5 : 100);
  else if (e.ctrlKey && key === 'ArrowDown')
    updateVolume(player.volume - 0.05 >= 0 ? player.volume * 100 - 5 : 0);
  else if (e.ctrlKey && key === 'm') toggleMutedState(!store.state.player.volume.isMuted);
  else if (e.ctrlKey && key === 'ArrowRight') handleSkipForwardClick();
  else if (e.ctrlKey && key === 'ArrowLeft') handleSkipBackwardClick();
  else if (e.ctrlKey && key === 's') toggleShuffling();
  else if (e.ctrlKey && key === 't') toggleRepeat();
  else if (e.ctrlKey && key === 'h') toggleIsFavorite();
  else if (e.ctrlKey && key === 'y') window.api.theme.changeAppTheme();
  else if (e.ctrlKey && key === 'l') {
    const currentlyActivePage =
      store.state.navigationHistory.history[store.state.navigationHistory.pageHistoryIndex];
    // Leaving Lyrics goes back to the page it was opened from, as the player's lyrics button does.
    if (currentlyActivePage.pageTitle !== 'Lyrics') changeCurrentActivePage('Lyrics');
    else if (store.state.navigationHistory.pageHistoryIndex > 0) updatePageHistoryIndex('decrement');
    else changeCurrentActivePage('Home');
  } else if (e.ctrlKey && key === 'n')
    updatePlayerType(store.state.playerType === 'mini' ? 'normal' : 'mini');
  else if (e.ctrlKey && key === 'q') {
    const currentlyActivePage =
      store.state.navigationHistory.history[store.state.navigationHistory.pageHistoryIndex];
    if (currentlyActivePage.pageTitle !== 'CurrentQueue') changeCurrentActivePage('CurrentQueue');
    // Leaving the queue goes back to the page it was opened from, as Lyrics does.
    else if (store.state.navigationHistory.pageHistoryIndex > 0) updatePageHistoryIndex('decrement');
    else changeCurrentActivePage('Home');
  } else if (e.ctrlKey && (key === 'k' || key === 'f'))
    // The top bar's search field takes the focus; focusing it opens the Search page.
    window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
  else if (e.ctrlKey && key === ']') {
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
  } else if (e.ctrlKey && key === '[') {
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
  } else if (e.ctrlKey && key === '\\') {
    storage.setItem('playback', 'playbackRate', 1);
    addNewNotifications([
      {
        id: 'playbackRate',
        iconName: 'avg_pace',
        content: t('notifications.playbackRateReset')
      }
    ]);
  } else if (e.ctrlKey && key === '/') changePromptMenuData(true, <AppShortcutsPrompt />);
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
