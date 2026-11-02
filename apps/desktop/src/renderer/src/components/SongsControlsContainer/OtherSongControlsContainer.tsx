/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { lazy, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import VolumeSlider from '../VolumeSlider';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import SoundPanel from './SoundPanel';
import { isEffectOn, soundPanelStore, soundStore, speedLabel, versionStore } from '../../other/soundEffects';

const AppShortcutsPrompt = lazy(() => import('../SettingsPage/AppShortcutsPrompt'));
const WhyThisSongPrompt = lazy(() => import('../WhyThisSongPrompt'));

const OtherSongControlsContainer = () => {
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  const isMuted = useStore(store, (state) => state.player.volume.isMuted);
  const volume = useStore(store, (state) => state.player.volume.value);
  const globalSound = useStore(soundStore, (s) => s);
  const playingVersion = useStore(versionStore, (s) => s);
  const sound = playingVersion?.sound ?? globalSound;
  const isSoundOpen = useStore(soundPanelStore, (s) => s);
  const isSoundOn = isEffectOn(sound);

  const {
    changeCurrentActivePage,
    updatePlayerType,
    toggleMutedState,
    updateContextMenuData,
    changePromptMenuData,
    updatePageHistoryIndex
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const openOtherSettingsContextMenu = useCallback(
    (pageX: number, pageY: number) => {
      updateContextMenuData(
        true,
        [
          {
            label: t('settingsPage.appShortcuts'),
            iconName: 'trail_length_short',
            iconClassName: 'ms-icon mr-2',
            handlerFunction: () => changePromptMenuData(true, <AppShortcutsPrompt />)
          },
          { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
          {
            label: t('settingsPage.equalizer'),
            iconName: 'graphic_eq',
            iconClassName: 'ms-icon mr-2',
            handlerFunction: () =>
              changeCurrentActivePage('Settings', {
                scrollToId: '#equalizer'
              })
          },
          {
            label: t('sound.title'),
            iconName: 'speed',
            iconClassName: 'ms-icon mr-2',
            // The speed lives in the Slowed & reverb panel now (PLAN/18), Keep pitch included.
            handlerFunction: () => soundPanelStore.setState(() => true)
          },
          { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
          // "Why this song?" (PLAN/14 C1), while Smart Shuffle is on and its reasons are shown.
          ...(store.state.player.isTierShuffling &&
          !store.state.localStorage.preferences.isShuffleReasonsHidden &&
          store.state.currentSongData.songId
            ? [
                {
                  label: t('smartShuffle.whyThisSong'),
                  iconName: 'auto_fix',
                  iconClassName: 'ms-icon mr-2',
                  handlerFunction: () =>
                    changePromptMenuData(
                      true,
                      <WhyThisSongPrompt
                        songId={store.state.currentSongData.songId}
                        title={store.state.currentSongData.title}
                      />,
                      '!max-w-[34rem]'
                    )
                }
              ]
            : []),
          {
            label: t('player.showCurrentQueue'),
            iconName: 'table_rows',
            iconClassName: 'ms-icon mr-2',
            handlerFunction: () => changeCurrentActivePage('CurrentQueue')
          },
          { label: '', isContextMenuItemSeperator: true, handlerFunction: () => true },
          {
            label: t('player.showMiniPlayer'),
            iconName: 'pip',
            iconClassName: 'ms-icon mr-2',
            handlerFunction: () => updatePlayerType('mini')
          },
          {
            label: t('player.openInFullScreen'),
            iconName: 'fullscreen',
            iconClassName: 'ms-icon mr-2',
            handlerFunction: () => updatePlayerType('full')
          }
        ],
        pageX,
        pageY
      );
    },
    [changeCurrentActivePage, changePromptMenuData, t, updateContextMenuData, updatePlayerType]
  );

  const look = (isOn = false) => `!m-0 !h-8 !w-8 ${isOn ? '!text-echo hover:!text-echo' : ''}`;

  return (
    <div className="other-controls-container flex min-w-0 items-center justify-end gap-1 pr-4">
      <Button
        className={`queue-btn lg:hidden ${look(currentlyActivePage.pageTitle === 'CurrentQueue')}`}
        tooltipLabel={t('player.currentQueue')}
        iconName="queue_music"
        isActive={currentlyActivePage.pageTitle === 'CurrentQueue'}
        clickHandler={() => {
          if (currentlyActivePage.pageTitle !== 'CurrentQueue') changeCurrentActivePage('CurrentQueue');
          // Leaving the queue goes back to the page it was opened from, as Lyrics does.
          else if (store.state.navigationHistory.pageHistoryIndex > 0) updatePageHistoryIndex('decrement');
          else changeCurrentActivePage('Home');
        }}
      />
      <Button
        className={`mini-player-btn lg:hidden ${look()}`}
        clickHandler={() => updatePlayerType('mini')}
        tooltipLabel={t('player.openInMiniPlayer')}
        iconName="pip"
      />
      <Button
        className={`full-screen-player-btn lg:hidden ${look()}`}
        tooltipLabel={t('player.openInFullScreen')}
        iconName="open_in_full"
        clickHandler={() => updatePlayerType('full')}
      />
      {/* Slowed & reverb (PLAN/18): lit, with the speed beside it, while an effect is on. */}
      <div className="relative flex items-center">
        <Button
          className={`sound-btn ${look(isSoundOn || isSoundOpen)}`}
          tooltipLabel={t('sound.title')}
          iconName="speed"
          isActive={isSoundOn}
          clickHandler={() => soundPanelStore.setState((open) => !open)}
        />
        {isSoundOn && Math.abs(sound.semitones) > 1e-9 && (
          <span className="pointer-events-none -ml-1 mr-1 text-[10px] font-semibold tabular-nums text-echo">
            {speedLabel(sound.semitones, sound.unit).replace(' st', '')}
          </span>
        )}
        <SoundPanel />
      </div>
      <Button
        className={`volume-btn ml-1 ${look(isMuted)}`}
        tooltipLabel={t('player.muteUnmute')}
        iconName={isMuted ? 'volume_off' : volume > 50 ? 'volume_up' : 'volume_down'}
        isActive={isMuted}
        clickHandler={() => toggleMutedState(!isMuted)}
      />
      <div className="volume-slider-container w-[7.5rem] min-w-[5rem] shrink">
        <VolumeSlider name="player-volume-slider" id="volumeSlider" />
      </div>
      <Button
        className={`other-settings-btn ml-1 ${look()}`}
        tooltipLabel={t('player.otherSettings')}
        iconName="more_horiz"
        clickHandler={(e) => {
          e.preventDefault();
          e.stopPropagation?.();
          const coords = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openOtherSettingsContextMenu(coords.x, coords.y);
        }}
        onContextMenu={(e) => openOtherSettingsContextMenu(e.pageX, e.pageY)}
      />
    </div>
  );
};

export default OtherSongControlsContainer;
