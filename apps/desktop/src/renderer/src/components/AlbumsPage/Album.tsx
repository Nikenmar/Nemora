import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import SongArtist from '../SongsPage/SongArtist';
import DefaultAlbumCover from '../../assets/images/webp/album_cover_default.webp';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

interface AlbumProp extends Album {
  index: number;
  className?: string;
  selectAllHandler?: (_upToId?: string) => void;
}

export const Album = (props: AlbumProp) => {
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);

  const {
    changeCurrentActivePage,
    createQueue,
    updateContextMenuData,
    updateQueueData,
    addNewNotifications,
    updateMultipleSelections,
    toggleMultipleSelections
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const playAlbumSongs = useCallback(
    (isShuffle = false) => {
      return window.api.audioLibraryControls
        .getSongInfo(
          props.songs.map((song) => song.songId),
          undefined,
          undefined,
          undefined,
          true
        )
        .then((songs) => {
          if (Array.isArray(songs))
            return createQueue(
              songs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'album',
              isShuffle,
              props.albumId,
              true
            );
          return undefined;
        });
    },
    [createQueue, props.albumId, props.songs]
  );

  const playAlbumSongsForMultipleSelections = useCallback(
    (isShuffle = false) => {
      const { multipleSelections: albumIds } = multipleSelectionsData;

      window.api.albumsData
        .getAlbumData(albumIds)
        .then((albums) => {
          if (Array.isArray(albums) && albums.length > 0) {
            const albumSongIds = albums
              .map((album) => album.songs.map((song) => song.songId))
              .flat();

            return window.api.audioLibraryControls.getSongInfo(
              albumSongIds,
              undefined,
              undefined,
              undefined,
              true
            );
          }
          return undefined;
        })
        .then((songs) => {
          if (Array.isArray(songs))
            return createQueue(
              songs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'songs',
              isShuffle,
              undefined,
              true
            );
          return undefined;
        })
        .catch((err) => console.error(err));
    },
    [createQueue, multipleSelectionsData]
  );

  const addToQueueForMultipleSelections = useCallback(() => {
    const { multipleSelections: albumIds } = multipleSelectionsData;
    window.api.genresData
      .getGenresData(albumIds)
      .then((albums) => {
        if (Array.isArray(albums) && albums.length > 0) {
          const albumSongIds = albums.map((album) => album.songs.map((song) => song.songId)).flat();

          return window.api.audioLibraryControls.getSongInfo(
            albumSongIds,
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
              content: t('notifications.addedToQueue', { count: songs.length })
            }
          ]);
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [addNewNotifications, multipleSelectionsData, queue.queue, t, updateQueueData]);

  const showAlbumInfoPage = useCallback(
    () =>
      currentlyActivePage?.data?.albumId !== props.albumId &&
      changeCurrentActivePage('AlbumInfo', {
        albumId: props.albumId
      }),
    [changeCurrentActivePage, currentlyActivePage?.data, props.albumId]
  );

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'album') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (
      multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === props.albumId)
    )
      return true;
    return false;
  }, [multipleSelectionsData, props.albumId]);

  const albumArtists = useMemo(() => {
    const { artists } = props;
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className={
                isAMultipleSelection ? '!text-ink' : ''
              }
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i)
            arr.push(
              <span key={`${artists[i].name},${artists[i + 1].name}`} className="mr-1">
                ,
              </span>
            );

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
  }, [isAMultipleSelection, props, t]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'album' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;
    return [
      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playAll' : 'play'}`),
        iconName: 'play_arrow',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) playAlbumSongsForMultipleSelections();
          else playAlbumSongs();
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t(`common.shuffleAndPlayAll`)
          : t(`common.shuffleAndPlay`),
        iconName: 'shuffle',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) playAlbumSongsForMultipleSelections(true);
          else playAlbumSongs(true);
        }
      },
      {
        label: t(`common.addToQueue`),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) addToQueueForMultipleSelections();
          else {
            queue.queue.push(...props.songs.map((song) => song.songId));
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
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: null
      },
      {
        label: t(`common.info`),
        iconName: 'info',
        handlerFunction: showAlbumInfoPage
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            return updateMultipleSelections(
              props.albumId,
              'album',
              isAMultipleSelection ? 'remove' : 'add'
            );
          }
          return toggleMultipleSelections(!isAMultipleSelection, 'album', [props.albumId]);
        }
      }
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !props.selectAllHandler,
      //   handlerFunction: () =>
      //     props.selectAllHandler && props.selectAllHandler(),
      // },
    ];
  }, [
    addNewNotifications,
    addToQueueForMultipleSelections,
    isAMultipleSelection,
    isMultipleSelectionEnabled,
    multipleSelectionsData.multipleSelections.length,
    multipleSelectionsData.selectionType,
    playAlbumSongs,
    playAlbumSongsForMultipleSelections,
    props.albumId,
    props.songs,
    queue.queue,
    showAlbumInfoPage,
    t,
    toggleMultipleSelections,
    updateMultipleSelections,
    updateQueueData
  ]);

  const contextMenuItemData = useMemo(
    (): ContextMenuAdditionalData =>
      isMultipleSelectionEnabled &&
      multipleSelectionsData.selectionType === 'album' &&
      isAMultipleSelection
        ? {
            title: t('album.selectedAlbumCount', {
              count: multipleSelectionsData.multipleSelections.length
            }),
            artworkPath: DefaultAlbumCover
          }
        : {
            title: props.title,
            artworkPath: props?.artworkPaths?.optimizedArtworkPath,
            subTitle: t('common.songWithCount', { count: props.songs.length }),
            subTitle2:
              props.artists?.map((artist) => artist.name).join(', ') || t('common.unknownArtist')
          },
    [
      isAMultipleSelection,
      isMultipleSelectionEnabled,
      multipleSelectionsData.multipleSelections.length,
      multipleSelectionsData.selectionType,
      props.artists,
      props?.artworkPaths?.optimizedArtworkPath,
      props.songs.length,
      props.title,
      t
    ]
  );

  const isSelectable = isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'album';

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`album group mb-6 mr-5 flex w-[11.5rem] cursor-pointer flex-col gap-2 ${props.className ?? ''}`}
      onContextMenu={(e) =>
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData)
      }
      onClick={(e) => {
        if (e.getModifierState('Shift') === true && props.selectAllHandler)
          props.selectAllHandler(props.albumId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'album', [props.albumId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'album')
          updateMultipleSelections(props.albumId, 'album', isAMultipleSelection ? 'remove' : 'add');
        else showAlbumInfoPage();
      }}
    >
      <div
        className={`album-cover-and-play-btn-container relative aspect-square w-full overflow-hidden rounded-cover bg-surface-2 ${
          isAMultipleSelection ? 'ring-2 ring-echo ring-offset-2 ring-offset-canvas' : ''
        }`}
      >
        <Img
          src={props.artworkPaths.artworkPath}
          fallbackSrc={DefaultAlbumCover}
          loading="lazy"
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          enableImgFadeIns={!isMultipleSelectionEnabled}
        />
        {isSelectable ? (
          <MultipleSelectionCheckbox
            id={props.albumId}
            selectionType="album"
            className="absolute bottom-2 right-2 z-10"
          />
        ) : (
          <button
            type="button"
            className="absolute bottom-2 right-2 flex h-10 w-10 translate-y-1 items-center justify-center rounded-full bg-accent text-on-accent opacity-0 shadow-[0_6px_18px_rgb(0_0_0/0.4)] outline-none transition-[opacity,transform] duration-200 ease-out hover:scale-105 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            aria-label={t('common.playAll')}
            onClick={(e) => {
              e.stopPropagation();
              playAlbumSongs();
            }}
          >
            <span className="ms-icon ms-icon-filled text-[24px]">play_arrow</span>
          </button>
        )}
      </div>
      <div className="album-info-container min-w-0 px-0.5">
        <button
          type="button"
          className="album-title block w-full truncate text-left text-body font-medium text-ink outline-none hover:underline focus-visible:underline"
          title={props.title}
          onClick={(e) => {
            e.stopPropagation();
            showAlbumInfoPage();
          }}
        >
          {props.title}
        </button>
        {props.artists && (
          <div
            className="album-artists mt-0.5 flex w-full truncate text-small text-ink-dim"
            title={props.artists.map((artist) => artist.name).join(', ')}
          >
            {albumArtists}
          </div>
        )}
        <div className="album-no-of-songs mt-0.5 truncate text-micro text-ink-faint">
          {t('common.songWithCount', { count: props.songs.length })}
        </div>
      </div>
    </div>
  );
};
