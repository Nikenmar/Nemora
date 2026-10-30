/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { lazy, useCallback, useContext, useMemo } from 'react';
import { isPinnedPlaylist, togglePinnedPlaylist } from '../../other/pinnedPlaylists';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import DefaultPlaylistCover from '../../assets/images/webp/playlist_cover_default.webp';
import MultipleArtworksCover from './MultipleArtworksCover';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const ConfirmDeletePlaylistsPrompt = lazy(() => import('./ConfirmDeletePlaylistsPrompt'));
const RenamePlaylistPrompt = lazy(() => import('./RenamePlaylistPrompt'));

interface PlaylistProp extends Playlist {
  index: number;
  selectAllHandler?: (_upToId?: string) => void;
}

export const Playlist = (props: PlaylistProp) => {
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const queue = useStore(store, (state) => state.localStorage.queue);

  const {
    updateQueueData,
    updateContextMenuData,
    changeCurrentActivePage,
    changePromptMenuData,
    createQueue,
    toggleMultipleSelections,
    updateMultipleSelections,
    addNewNotifications
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const openPlaylistInfoPage = useCallback(
    () =>
      changeCurrentActivePage('PlaylistInfo', {
        playlistId: props.playlistId
      }),
    [changeCurrentActivePage, props.playlistId]
  );

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'playlist') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (
      multipleSelectionsData.multipleSelections.some(
        (selectionId) => selectionId === props.playlistId
      )
    )
      return true;
    return false;
  }, [multipleSelectionsData, props.playlistId]);

  const playAllSongs = useCallback(
    (isShuffling = false) => {
      window.api.audioLibraryControls
        .getSongInfo(props.songs, undefined, undefined, undefined, true)
        .then((songs) => {
          if (Array.isArray(songs))
            return createQueue(
              songs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'playlist',
              isShuffling,
              props.playlistId,
              true
            );
          return undefined;
        })
        .catch((err) => console.error(err));
    },
    [createQueue, props.playlistId, props.songs]
  );

  const playAllSongsForMultipleSelections = useCallback(
    (isShuffling = false) => {
      const { multipleSelections: playlistIds } = multipleSelectionsData;
      window.api.playlistsData
        .getPlaylistData(playlistIds)
        .then((playlists) => {
          const ids = playlists.map((playlist) => playlist.songs).flat();

          return window.api.audioLibraryControls.getSongInfo(
            ids,
            undefined,
            undefined,
            undefined,
            true
          );
        })
        .then((songs) => {
          if (Array.isArray(songs)) {
            const songIds = songs.filter((song) => !song.isBlacklisted).map((song) => song.songId);
            createQueue(songIds, 'songs', isShuffling);
            return addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                duration: 5000,
                content: t(`notifications.addedToQueue`, {
                  count: songIds.length
                })
              }
            ]);
          }
          return undefined;
        })
        .catch((err) => console.error(err));
    },
    [addNewNotifications, createQueue, multipleSelectionsData, t]
  );

  const addToQueueForMultipleSelections = useCallback(() => {
    const { multipleSelections: playlistIds } = multipleSelectionsData;
    window.api.playlistsData
      .getPlaylistData(playlistIds)
      .then((playlists) => {
        if (Array.isArray(playlists) && playlists.length > 0) {
          const playlistSongIds = playlists.map((playlist) => playlist.songs).flat();

          return window.api.audioLibraryControls.getSongInfo(
            playlistSongIds,
            undefined,
            undefined,
            undefined,
            true
          );
        }
        return undefined;
      })
      .then((songs) => {
        if (Array.isArray(songs)) {
          queue.queue.push(
            ...songs.filter((song) => !song.isBlacklisted).map((song) => song.songId)
          );
          updateQueueData(undefined, queue.queue);
          addNewNotifications([
            {
              id: 'newSongsToQueue',
              duration: 5000,
              content: t(`notifications.addedToQueue`, {
                count: songs.length
              })
            }
          ]);
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [addNewNotifications, multipleSelectionsData, queue.queue, t, updateQueueData]);

  const contextMenus: ContextMenuItem[] = useMemo(() => {
    const { multipleSelections: playlistIds } = multipleSelectionsData;
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'playlist' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    return [
      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playAll' : 'play'}`),
        iconName: 'play_arrow',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) playAllSongsForMultipleSelections();
          else playAllSongs();
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t(`common.shuffleAndPlayAll`)
          : t(`common.shuffleAndPlay`),
        iconName: 'shuffle',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) playAllSongsForMultipleSelections(true);
          else playAllSongs(true);
        }
      },
      {
        label: t(`common.addToQueue`),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) addToQueueForMultipleSelections();
          else {
            queue.queue.push(...props.songs);
            updateQueueData(undefined, queue.queue);
            addNewNotifications([
              {
                id: 'newSongsToQueue',
                duration: 5000,
                content: t(`notifications.addedToQueue`, {
                  count: props.songs.length
                })
              }
            ]);
          }
        }
      },
      {
        label: isPinnedPlaylist(props.playlistId)
          ? t('sideBar.unpin', 'Unpin from sidebar')
          : t('sideBar.pin', 'Pin to sidebar'),
        iconName: isPinnedPlaylist(props.playlistId) ? 'keep_off' : 'keep',
        isDisabled: isMultipleSelectionsEnabled,
        handlerFunction: () => void togglePinnedPlaylist(props.playlistId)
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true
      },
      {
        label: t(`playlist.${props.isArtworkAvailable ? 'changeArtwork' : 'addArtwork'}`),
        iconName: 'photo_camera',
        handlerFunction: () => {
          window.api.songUpdates
            .getImgFileLocation()
            .then((artworkPath) => {
              if (artworkPath) {
                return window.api.playlistsData.addArtworkToAPlaylist(
                  props.playlistId,
                  artworkPath
                );
              }
              return undefined;
            })
            .then(() => {
              return addNewNotifications([
                {
                  content: t('playlist.playlistArtworkUpdateSuccess'),
                  icon: <span className="ms-icon">done</span>,
                  duration: 5000,
                  id: 'PlaylistArtworkUpdateSuccessful'
                }
              ]);
            })
            .catch((err) => console.error(err));
        },
        isDisabled: isMultipleSelectionsEnabled
          ? false
          : props.playlistId === 'History' ||
            props.playlistId === 'Favorites' ||
            props.playlistId === 'Rediscover'
      },
      {
        label: t('playlist.renamePlaylist'),
        iconName: 'edit',
        handlerFunction: () => {
          changePromptMenuData(true, <RenamePlaylistPrompt playlistData={props} />);
        },
        isDisabled: isMultipleSelectionsEnabled
          ? false
          : props.playlistId === 'History' ||
            props.playlistId === 'Favorites' ||
            props.playlistId === 'Rediscover'
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            updateMultipleSelections(
              props.playlistId,
              'playlist',
              isAMultipleSelection ? 'remove' : 'add'
            );
          } else toggleMultipleSelections(!isAMultipleSelection, 'playlist', [props.playlistId]);
        }
      },
      {
        label: t('playlist.exportPlaylist'),
        iconName: 'upload',
        handlerFunction: () => window.api.playlistsData.exportPlaylist(props.playlistId),
        isDisabled: isMultipleSelectionsEnabled
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !props.selectAllHandler,
      //   handlerFunction: () =>
      //     props.selectAllHandler && props.selectAllHandler(),
      // },
      {
        label: t('common.info'),
        iconName: 'info',
        handlerFunction: openPlaylistInfoPage,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
          ? false
          : props.playlistId === 'History' ||
            props.playlistId === 'Favorites' ||
            props.playlistId === 'Rediscover'
      },
      {
        label: t(
          `playlist.${isMultipleSelectionsEnabled ? 'deleteSelectedPlaylists' : 'deletePlaylist_one'}`
        ),
        iconName: 'delete_outline',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <ConfirmDeletePlaylistsPrompt
              playlistIds={isMultipleSelectionsEnabled ? playlistIds : [props.playlistId]}
              playlistName={props.name}
            />
          );
          toggleMultipleSelections(false);
        },
        isDisabled: isMultipleSelectionsEnabled
          ? false
          : props.playlistId === 'History' ||
            props.playlistId === 'Favorites' ||
            props.playlistId === 'Rediscover'
      }
    ];
  }, [
    addNewNotifications,
    addToQueueForMultipleSelections,
    changePromptMenuData,
    isAMultipleSelection,
    isMultipleSelectionEnabled,
    multipleSelectionsData,
    openPlaylistInfoPage,
    playAllSongs,
    playAllSongsForMultipleSelections,
    props,
    queue.queue,
    t,
    toggleMultipleSelections,
    updateMultipleSelections,
    updateQueueData
  ]);

  const contextMenuItemData = useMemo(
    (): ContextMenuAdditionalData =>
      isMultipleSelectionEnabled &&
      multipleSelectionsData.selectionType === 'playlist' &&
      isAMultipleSelection
        ? {
            title: t('playlist.selectedPlaylistCount', {
              count: multipleSelectionsData.multipleSelections.length
            }),
            artworkPath: DefaultPlaylistCover
          }
        : {
            title: props.name,
            artworkPath: props?.artworkPaths?.optimizedArtworkPath,
            subTitle: t('common.songWithCount', { count: props.songs.length })
          },
    [
      isAMultipleSelection,
      isMultipleSelectionEnabled,
      multipleSelectionsData.multipleSelections.length,
      multipleSelectionsData.selectionType,
      props?.artworkPaths?.optimizedArtworkPath,
      props.name,
      props.songs.length,
      t
    ]
  );

  const isSelectable = isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'playlist';

  return (
    <div
      className={`playlist group ${props.playlistId} mb-6 mr-5 flex w-[9.5rem] cursor-pointer flex-col gap-2 text-ink`}
      data-playlist-id={props.playlistId}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenus, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        if (e.getModifierState('Shift') === true && props.selectAllHandler)
          props.selectAllHandler(props.playlistId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'playlist', [props.playlistId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'playlist')
          updateMultipleSelections(
            props.playlistId,
            'playlist',
            isAMultipleSelection ? 'remove' : 'add'
          );
        else openPlaylistInfoPage();
      }}
    >
      <div
        className={`playlist-cover-and-play-btn-container relative aspect-square w-full overflow-hidden rounded-cover bg-surface-2 ${
          isAMultipleSelection ? 'ring-2 ring-echo ring-offset-2 ring-offset-canvas' : ''
        }`}
      >
        {preferences?.enableArtworkFromSongCovers && props.songs.length > 2 ? (
          <MultipleArtworksCover
            songIds={props.songs}
            className="aspect-square w-full"
            enableImgFadeIns={!isMultipleSelectionEnabled}
          />
        ) : (
          <Img
            src={props.artworkPaths.artworkPath}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
            enableImgFadeIns={!isMultipleSelectionEnabled}
          />
        )}
        {isSelectable ? (
          <MultipleSelectionCheckbox
            id={props.playlistId}
            selectionType="playlist"
            className="absolute bottom-2 right-2 z-10"
          />
        ) : (
          <button
            type="button"
            className="absolute bottom-2 right-2 z-10 flex h-10 w-10 translate-y-1 items-center justify-center rounded-full bg-accent text-on-accent opacity-0 shadow-[0_6px_18px_rgb(0_0_0/0.4)] outline-none transition-[opacity,transform] duration-200 ease-out hover:scale-105 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            aria-label={t('common.playAll')}
            onClick={(e) => {
              e.stopPropagation();
              playAllSongs();
            }}
          >
            <span className="ms-icon ms-icon-filled text-[24px]">play_arrow</span>
          </button>
        )}
      </div>
      <div className="playlist-info-container min-w-0 px-0.5">
        <button
          type="button"
          className="playlist-title block w-full truncate text-left text-body font-medium text-ink outline-none hover:underline focus-visible:underline"
          title={props.name}
          onClick={(e) => {
            e.stopPropagation();
            if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'playlist')
              updateMultipleSelections(
                props.playlistId,
                'playlist',
                isAMultipleSelection ? 'remove' : 'add'
              );
            else openPlaylistInfoPage();
          }}
        >
          {props.name}
        </button>
        <div className="playlist-no-of-songs mt-0.5 text-small text-ink-dim">
          {t('common.songWithCount', { count: props.songs.length })}
        </div>
      </div>
    </div>
  );
};
