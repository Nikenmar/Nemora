/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import SongArtist from './SongArtist';

const AddSongsToPlaylistsPrompt = lazy(() => import('./AddSongsToPlaylistsPrompt'));
const BlacklistSongConfrimPrompt = lazy(() => import('./BlacklistSongConfirmPrompt'));
const DeleteSongsFromSystemConfrimPrompt = lazy(
  () => import('./DeleteSongsFromSystemConfrimPrompt')
);

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { flyToQueue } from '../../other/motion';

interface SongCardProp {
  index: number;
  songId: string;
  artworkPath: string;
  path: string;
  title: string;
  artists?: { name: string; artistId: string }[];
  album?: { name: string; albumId: string };
  palette?: NodeVibrantPalette;
  isAFavorite: boolean;
  className?: string;
  isBlacklisted: boolean;
  selectAllHandler?: (_upToId?: string) => void;
}

const SongCard = (props: SongCardProp) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  // On its own: toggleIsFavorite sets the flag on the current object before dispatching a copy, and
  // the store compares selections shallowly, so the whole object never shows the change.
  const isCurrentSongAFavorite = useStore(store, (state) => state.currentSongData.isAFavorite);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const doNotShowBlacklistSongConfirm = useStore(
    store,
    (state) => state.localStorage.preferences.doNotShowBlacklistSongConfirm
  );
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    playSong,
    updateContextMenuData,
    changeCurrentActivePage,
    updateQueueData,
    addNewNotifications,
    changePromptMenuData,
    toggleIsFavorite,
    toggleMultipleSelections,
    updateMultipleSelections,
    createQueue
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const {
    title,
    artworkPath,
    isAFavorite,
    path,
    songId,
    artists,
    album,
    className,
    isBlacklisted,
    selectAllHandler
  } = props;

  const [isSongAFavorite, setIsSongAFavorite] = useState(
    songId === currentSongData.songId ? currentSongData.isAFavorite : isAFavorite
  );
  const [isSongPlaying, setIsSongPlaying] = useState(
    currentSongData ? currentSongData.songId === songId && isCurrentSongPlaying : false
  );
  useEffect(() => {
    setIsSongPlaying(() => {
      if (currentSongData) return currentSongData.songId === songId && isCurrentSongPlaying;
      return false;
    });
    setIsSongAFavorite((prevState) => {
      if (currentSongData?.songId === songId) return isCurrentSongAFavorite;
      return prevState;
    });
  }, [currentSongData, isCurrentSongAFavorite, isCurrentSongPlaying, songId]);


  const handlePlayBtnClick = useCallback(() => {
    playSong(songId);
  }, [playSong, songId]);

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'songs') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === songId))
      return true;
    return false;
  }, [multipleSelectionsData, songId]);

  const contextMenuItemData =
    isMultipleSelectionEnabled &&
    multipleSelectionsData.selectionType === 'songs' &&
    isAMultipleSelection
      ? {
          title: t('song.selectedSongCount', {
            count: multipleSelectionsData.multipleSelections.length
          }),
          artworkPath: DefaultSongCover
        }
      : {
          title: title || t('common.unknownTitle'),
          subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
          artworkPath
        };

  const showSongInfoPage = () =>
    changeCurrentActivePage('SongInfo', {
      songId
    });

  const handleLikeButtonClick = useCallback(() => {
    window.api.playerControls
      .toggleLikeSongs([songId], !isSongAFavorite)
      .then((res) => {
        if (res && res.likes.length + res.dislikes.length > 0) {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          return setIsSongAFavorite((prevData) => !prevData);
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [
    currentSongData.isAFavorite,
    currentSongData.songId,
    isSongAFavorite,
    songId,
    toggleIsFavorite
  ]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'songs' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    const { multipleSelections: songIds } = multipleSelectionsData;

    const items: ContextMenuItem[] = [
      {
        label: t('common.play'),
        handlerFunction: () => {
          handlePlayBtnClick();
        },
        iconName: 'play_arrow',
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.createAQueue'),
        handlerFunction: () => {
          createQueue(songIds, 'songs', false, undefined, true);
        },
        iconName: 'queue_music',
        isDisabled: !isMultipleSelectionsEnabled
      },

      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playNextAll' : 'playNext'}`),
        iconName: 'shortcut',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            let currentSongIndex =
              queue.currentSongIndex ?? queue.queue.indexOf(currentSongData.songId);
            const duplicateIds: string[] = [];

            const newQueue = queue.queue.filter((id) => {
              const isADuplicate = songIds.includes(id);
              if (isADuplicate) duplicateIds.push(id);

              return !isADuplicate;
            });

            for (const duplicateId of duplicateIds) {
              const duplicateIdPosition = queue.queue.indexOf(duplicateId);

              if (
                duplicateIdPosition !== -1 &&
                duplicateIdPosition < currentSongIndex &&
                currentSongIndex - 1 >= 0
              )
                currentSongIndex -= 1;
            }

            newQueue.splice(currentSongIndex + 1, 0, ...songIds);

            updateQueueData(currentSongIndex, newQueue, undefined, false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNextSongsWithCount', {
                  count: songIds.length
                }),
                iconName: 'shortcut'
              }
            ]);
          } else {
            const newQueue = queue.queue.filter((id) => id !== songId);
            newQueue.splice(newQueue.indexOf(currentSongData.songId) + 1 || 0, 0, songId);

            const duplicateSongIndex = queue.queue.indexOf(songId);

            const currentSongIndex =
              queue.currentSongIndex &&
              duplicateSongIndex !== -1 &&
              duplicateSongIndex < queue.currentSongIndex
                ? queue.currentSongIndex - 1
                : undefined;

            updateQueueData(currentSongIndex, newQueue, undefined, false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNext', { title }),
                iconName: 'shortcut'
              }
            ]);
          }
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            updateQueueData(undefined, [...queue.queue, ...songIds], false);
            addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                content: t('notifications.addedToQueue', {
                  count: songIds.length
                }),
                iconName: 'add'
              }
            ]);
          } else {
            updateQueueData(undefined, [...queue.queue, songId], false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}AddedToQueue`,
                content: t('notifications.addedToQueue', {
                  count: 1
                }),
                icon: <Img src={artworkPath} loading="lazy" alt="Song Artwork" />
              }
            ]);
          }
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t('song.toggleLikeSongs')
          : t(`song.${isSongAFavorite ? 'unlikeSong' : 'likeSong'}`),
        iconName: `favorite`,
        iconClassName: isMultipleSelectionsEnabled
          ? 'ms-icon mr-4 text-xl'
          : isSongAFavorite
            ? 'ms-icon ms-icon-filled mr-4 text-xl'
            : 'ms-icon mr-4 text-xl',
        handlerFunction: () => {
          window.api.playerControls
            .toggleLikeSongs(isMultipleSelectionsEnabled ? [...songIds] : [songId])
            .then((res) => {
              if (res && res.likes.length + res.dislikes.length > 0) {
                if (isMultipleSelectionsEnabled) {
                  for (let i = 0; i < songIds.length; i += 1) {
                    const id = songIds[i];
                    if (currentSongData.songId === id)
                      toggleIsFavorite(!currentSongData.isAFavorite);
                    if (id === songId) setIsSongAFavorite((prevState) => !prevState);
                  }
                } else {
                  if (currentSongData.songId === songId)
                    toggleIsFavorite(!currentSongData.isAFavorite);
                  return setIsSongAFavorite((prevData) => !prevData);
                }
              }
              return undefined;
            })
            .catch((err) => console.error(err));
        }
      },
      {
        label: t('song.addToPlaylists'),
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt
              songIds={isAMultipleSelection ? songIds : [songId]}
              title={title}
            />
          );
        }
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            return updateMultipleSelections(
              songId,
              'songs',
              isAMultipleSelection ? 'remove' : 'add'
            );
          }
          return toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        }
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !selectAllHandler,
      //   handlerFunction: () => selectAllHandler && selectAllHandler(),
      // },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.dragOutFile'),
        class: 'drag-out-file',
        iconName: 'drag_indicator',
        handlerFunction: () => undefined,
        fileDrag: { paths: [path], artwork: artworkPath },
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.info'),
        class: 'info',
        iconName: 'info',
        handlerFunction: () =>
          changeCurrentActivePage('SongInfo', {
            songId
          }),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.goToAlbum'),
        iconName: 'album',
        handlerFunction: () =>
          album &&
          changeCurrentActivePage('AlbumInfo', {
            albumId: album?.albumId
          }),
        isDisabled: !album
      },
      {
        label: t('song.editSongTags'),
        class: 'edit',
        iconName: 'edit',
        handlerFunction: () =>
          changeCurrentActivePage('SongTagsEditor', {
            songId,
            songArtworkPath: artworkPath,
            songPath: path
          }),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.reparseSong'),
        class: 'sync',
        iconName: 'sync',
        handlerFunction: () => window.api.songUpdates.reParseSong(path),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t(`song.${isBlacklisted ? 'deblacklist' : 'blacklistSong'}`, {
          count: 1
        }),
        iconName: isBlacklisted ? 'settings_backup_restore' : 'block',
        handlerFunction: () => {
          if (isBlacklisted)
            window.api.audioLibraryControls
              .restoreBlacklistedSongs([songId])
              .catch((err) => console.error(err));
          else if (doNotShowBlacklistSongConfirm)
            window.api.audioLibraryControls
              .blacklistSongs([songId])
              .then(() =>
                addNewNotifications([
                  {
                    id: `${title}Blacklisted`,
                    duration: 5000,
                    content: t('notifications.songBlacklisted', { title }),
                    iconName: 'block'
                  }
                ])
              )
              .catch((err) => console.error(err));
          else
            changePromptMenuData(
              true,
              <BlacklistSongConfrimPrompt title={title} songIds={[songId]} />
            );
          return toggleMultipleSelections(false);
        },
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.delete'),
        iconName: 'delete',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <DeleteSongsFromSystemConfrimPrompt
              songIds={isMultipleSelectionsEnabled ? songIds : [songId]}
            />
          );
          toggleMultipleSelections(false);
        }
      }
    ];
    return items;
  }, [
    t,
    multipleSelectionsData,
    isAMultipleSelection,
    isSongAFavorite,
    album,
    isBlacklisted,
    handlePlayBtnClick,
    toggleMultipleSelections,
    createQueue,
    queue.currentSongIndex,
    queue.queue,
    currentSongData.songId,
    currentSongData.isAFavorite,
    updateQueueData,
    addNewNotifications,
    title,
    songId,
    artworkPath,
    toggleIsFavorite,
    changePromptMenuData,
    isMultipleSelectionEnabled,
    updateMultipleSelections,
    changeCurrentActivePage,
    path,
    doNotShowBlacklistSongConfirm
  ]);

  const songArtistComponents = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className="!text-small hover:text-ink"
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i)
            arr.push(
              <span className="mr-1" key={`${artists[i].name}=>${artists[i + 1].name}`}>
                ,
              </span>
            );

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
  }, [artists, t]);

  const isCurrent = currentSongData.songId === songId;
  const isNext =
    typeof queue.currentSongIndex === 'number' &&
    Array.isArray(queue.queue) &&
    queue.queue.length > 0 &&
    queue?.queue?.at(queue.currentSongIndex + 1) === songId;
  const badge = isCurrent
    ? t('song.playingNow')
    : isNext
      ? t('song.playingNext')
      : isBlacklisted
        ? t('song.blacklisted')
        : undefined;
  const isSelectable = isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs';

  return (
    <div
      className={`song song-card ${songId} ${isCurrent && 'current-song'} ${
        isSongPlaying && 'playing'
      } group/songCard relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-cover outline-none ${
        className || ''
      }`}
      data-song-id={songId}
      onDoubleClick={handlePlayBtnClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(songId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs')
          updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
      }}
      title={isBlacklisted ? `'${title}' is blacklisted.` : undefined}
    >
      <div
        className={`song-card-cover relative aspect-square w-full overflow-hidden rounded-cover bg-surface-2 ${
          isAMultipleSelection ? 'ring-2 ring-echo ring-offset-2 ring-offset-canvas' : ''
        }`}
      >
        <Img
          src={artworkPath}
          loading="eager"
          alt=""
          className={`h-full w-full object-cover transition-[transform,filter] duration-300 ease-out group-hover/songCard:scale-[1.03] ${
            isBlacklisted && 'brightness-50'
          }`}
          enableImgFadeIns={!isMultipleSelectionEnabled}
        />
        {badge && (
          <span className="absolute left-2 top-2 rounded-full bg-shade/60 px-2 py-0.5 text-micro font-medium text-on-media backdrop-blur-sm">
            {badge}
          </span>
        )}
        <button
          type="button"
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-shade/50 text-on-media outline-none backdrop-blur-sm transition-opacity duration-150 focus-visible:opacity-100 group-hover/songCard:opacity-100 ${
            isSongAFavorite ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label={isSongAFavorite ? t('song.likedThisSong') : t('song.dislikedThisSong')}
          aria-pressed={isSongAFavorite}
          onClick={(e) => {
            e.stopPropagation();
            handleLikeButtonClick();
          }}
        >
          <span className={`ms-icon text-[16px] ${isSongAFavorite ? 'ms-icon-filled' : ''}`}>favorite</span>
        </button>
        {isSelectable ? (
          <div className="absolute bottom-2 right-2">
            <MultipleSelectionCheckbox id={songId} selectionType="songs" className="!mr-0" />
          </div>
        ) : (
          <button
            type="button"
            className={`absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_6px_18px_rgb(0_0_0/0.4)] outline-none transition-[opacity,transform] duration-200 ease-out hover:scale-105 focus-visible:opacity-100 group-hover/songCard:translate-y-0 group-hover/songCard:opacity-100 ${
              isSongPlaying ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
            }`}
            aria-label={isSongPlaying ? t('player.pause', 'Pause') : t('player.play', 'Play')}
            onClick={(e) => {
              e.stopPropagation();
              handlePlayBtnClick();
            }}
          >
            <span className="ms-icon ms-icon-filled text-[24px]">{isSongPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
        )}
      </div>
      <div className="song-info-container min-w-0 px-0.5">
        <div
          className={`song-title truncate text-body font-medium outline-none hover:underline focus-visible:underline ${
            isCurrent ? 'text-echo' : 'text-ink'
          }`}
          title={title}
          onClick={(e) => {
            e.stopPropagation();
            showSongInfoPage();
          }}
          onKeyDown={(e) => e.key === 'Enter' && showSongInfoPage()}
          tabIndex={0}
        >
          {title}
        </div>
        <div
          className="song-artists mt-0.5 truncate text-small text-ink-dim"
          title={artists ? artists.map((x) => x.name).join(', ') : t('common.unknownArtist')}
          data-song-id={songId}
        >
          {songArtistComponents}
        </div>
      </div>
    </div>
  );
};

export default SongCard;
