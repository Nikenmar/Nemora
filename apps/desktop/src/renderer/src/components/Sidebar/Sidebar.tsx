import { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useTranslation } from 'react-i18next';

import ErrorBoundary from '../ErrorBoundary';
import SideBarItem from './SideBarItem';
import EloDuelDock from '../EloDuel/EloDuelDock';
import SongGuessrDock from '../SongGuessr/SongGuessrDock';
import Img from '../Img';
import Icon from '../ui/Icon';
import { cn } from '../ui/cn';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import {
  onPinnedPlaylistsChange,
  pinnedPlaylists,
  togglePinnedPlaylist
} from '../../other/pinnedPlaylists';

import PlaylistDefaultCover from '../../assets/images/webp/playlist_cover_default.webp';

interface Link {
  id: PageTitles;
  icon: string;
  content: string;
}

/**
 * The sidebar: Home, then the library, then what is yours, then the playlists pinned to it;
 * SongGuessr, Duel and Settings sit as three evenly spaced icons at the bottom. Search lives in the
 * title bar only. Below 1024 px the sidebar narrows to icons.
 */
const Sidebar = memo(() => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);

  const { changeCurrentActivePage, updateContextMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const groups = useMemo(
    (): { label?: string; links: Link[] }[] => [
      {
        links: [
          { id: 'Home', icon: 'home', content: t('sideBar.home') }
        ]
      },
      {
        label: t('sideBar.library', 'Library'),
        links: [
          { id: 'Songs', icon: 'music_note', content: t('common.song_other') },
          { id: 'Artists', icon: 'group', content: t('common.artist_other') },
          { id: 'Albums', icon: 'album', content: t('common.album_other') },
          { id: 'Genres', icon: 'category', content: t('common.genre_other') },
          { id: 'Folders', icon: 'folder', content: t('common.folder_other') }
        ]
      },
      {
        label: t('sideBar.yours', 'Yours'),
        links: [
          { id: 'Playlists', icon: 'queue_music', content: t('common.playlist_other') },
          { id: 'Tierlists', icon: 'leaderboard', content: t('sideBar.tierlists') },
          { id: 'Stats', icon: 'monitoring', content: t('sideBar.stats') }
        ]
      }
    ],
    [t]
  );

  const [pins, setPins] = useState<Playlist[]>([]);
  const loadPins = useCallback(async (ids?: string[]) => {
    const wanted = ids ?? (await pinnedPlaylists());
    if (wanted.length === 0) return setPins([]);
    const playlists = await window.api.playlistsData.getPlaylistData(wanted);
    setPins(
      wanted
        .map((id) => playlists.find((playlist) => playlist.playlistId === id))
        .filter((playlist): playlist is Playlist => !!playlist)
    );
  }, []);

  useEffect(() => {
    void loadPins();
    return onPinnedPlaylistsChange((ids) => void loadPins(ids));
  }, [loadPins]);

  const go = useCallback(
    (id: string, pageData?: PageData) => changeCurrentActivePage(id as PageTitles, pageData),
    [changeCurrentActivePage]
  );

  const activePage = currentlyActivePage.pageTitle;
  const activePlaylist =
    activePage === 'PlaylistInfo' ? (currentlyActivePage.data?.playlistId as string) : undefined;

  return (
    <nav
      aria-label={t('sideBar.navigation', 'Navigation')}
      className={cn(
        'side-bar relative z-20 order-1 flex !h-full w-[216px] shrink-0 flex-col bg-chrome lg:w-[72px]',
        bodyBackgroundImage && 'bg-chrome/60 backdrop-blur-md'
      )}
    >
      <ErrorBoundary>
        <ul className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 pb-2 pt-2.5 [scrollbar-width:none]">
          {groups.map((group, index) => (
            <li key={group.label ?? index} className="flex flex-col gap-0.5">
              {group.label && (
                <span className="px-3 pb-1 pt-4 text-micro text-ink-dim lg:hidden">{group.label}</span>
              )}
              {!group.label && index > 0 && <span className="h-3" />}
              <ul className="flex flex-col gap-0.5">
                {group.links.map((link) => (
                  <SideBarItem
                    key={link.id}
                    id={link.id}
                    icon={link.icon}
                    content={link.content}
                    handleClick={go}
                    isActive={activePage === link.id}
                  />
                ))}
              </ul>
            </li>
          ))}
          {pins.length > 0 && (
            <li className="flex flex-col gap-0.5 lg:hidden">
              <span className="px-3 pb-1 pt-4 text-micro text-ink-dim">{t('sideBar.pinned', 'Pinned')}</span>
              <ul className="flex flex-col gap-0.5">
                {pins.map((playlist) => (
                  <li key={playlist.playlistId}>
                    <button
                      type="button"
                      className={cn(
                        'flex h-8 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[12.5px] text-ink outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-echo',
                        activePlaylist === playlist.playlistId && 'bg-surface-2'
                      )}
                      onClick={() => go('PlaylistInfo', { playlistId: playlist.playlistId })}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        updateContextMenuData(
                          true,
                          [
                            {
                              label: t('sideBar.unpin', 'Unpin from sidebar'),
                              iconName: 'keep_off',
                              handlerFunction: () => void togglePinnedPlaylist(playlist.playlistId)
                            }
                          ],
                          e.pageX,
                          e.pageY
                        );
                      }}
                    >
                      <Img
                        src={playlist.artworkPaths?.optimizedArtworkPath}
                        fallbackSrc={PlaylistDefaultCover}
                        className="h-[22px] w-[22px] shrink-0 rounded-[4px] object-cover"
                        alt=""
                      />
                      <span className="truncate">{playlist.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
        <div className="grid shrink-0 grid-cols-3 place-items-center border-t border-line px-2.5 py-2 lg:grid-cols-1 lg:gap-1">
          <SongGuessrDock />
          <EloDuelDock />
          <button
            type="button"
            className={cn(
              'settings flex h-9 w-9 items-center justify-center rounded-full text-ink-dim outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-echo lg:ml-0',
              activePage === 'Settings' && 'bg-accent text-on-accent hover:bg-accent hover:text-on-accent'
            )}
            onClick={() => go('Settings')}
            aria-label={t('settingsPage.settings')}
            data-tooltip={t('settingsPage.settings')}
            aria-current={activePage === 'Settings' ? 'page' : undefined}
          >
            <Icon name="settings" filled={activePage === 'Settings'} size={20} />
          </button>
        </div>
      </ErrorBoundary>
    </nav>
  );
});

Sidebar.displayName = 'Sidebar';
export default Sidebar;
