/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import { useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import DefaultArtistCover from '../../assets/images/webp/artist_cover_default.webp';
import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

interface ArtistProp {
  index: number;
  className?: string;
  artistId: string;
  name: string;
  artworkPaths: ArtworkPaths;
  songIds: string[];
  onlineArtworkPaths?: {
    picture_small: string;
    picture_medium: string;
  };
  isAFavorite: boolean;
  selectAllHandler?: (_upToId?: string) => void;
  appearFromBottom?: boolean;
}

export const Artist = (props: ArtistProp) => {
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const queue = useStore(store, (state) => state.localStorage.queue);

  const { t } = useTranslation();

  const {
    changeCurrentActivePage,
    updateContextMenuData,
    createQueue,
    updateQueueData,
    addNewNotifications,
    toggleMultipleSelections,
    updateMultipleSelections
  } = useContext(AppUpdateContext);

  const { appearFromBottom = true } = props;

  const [isAFavorite, setIsAFavorite] = useState(props.isAFavorite);

  const goToArtistInfoPage = useCallback(() => {
    changeCurrentActivePage('ArtistInfo', {
      artistName: props.name,
      artistId: props.artistId
    });
  }, [changeCurrentActivePage, props.artistId, props.name]);

  const playArtistSongs = useCallback(
    (isShuffle = false) =>
      window.api.audioLibraryControls
        .getSongInfo(props.songIds, undefined, undefined, undefined, true)
        .then((songs) => {
          if (Array.isArray(songs))
            return createQueue(
              songs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'artist',
              isShuffle,
              props.artistId,
              true
            );
          return undefined;
        }),
    [createQueue, props.artistId, props.songIds]
  );

  const playArtistSongsForMultipleSelections = useCallback(
    (isShuffling = false) => {
      const { multipleSelections: artistIds } = multipleSelectionsData;

      return window.api.artistsData
        .getArtistData(artistIds)
        .then((res) => {
          if (Array.isArray(res) && res.length > 0) {
            const songIds = res.map((artist) => artist.songs.map((song) => song.songId)).flat();
            return window.api.audioLibraryControls.getSongInfo(songIds);
          }
          return undefined;
        })
        .then((songsData) => {
          if (Array.isArray(songsData) && songsData.length > 0) {
            return createQueue(
              songsData.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'artist',
              isShuffling,
              props.artistId,
              true
            );
          }
          return undefined;
        });
    },
    [createQueue, multipleSelectionsData, props.artistId]
  );

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'artist') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (
      multipleSelectionsData.multipleSelections.some(
        (selectionId) => selectionId === props.artistId
      )
    )
      return true;
    return false;
  }, [multipleSelectionsData, props.artistId]);

  const artistContextMenus: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'artist' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    return [
      {
        label: isMultipleSelectionsEnabled ? t(`artist.playAllSongs`) : t(`common.playAll`),
        iconName: 'play_arrow',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) return playArtistSongsForMultipleSelections();
          return playArtistSongs();
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t(`common.shuffleAndPlayAll`)
          : t(`common.shuffleAndPlay`),
        iconName: 'shuffle',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) return playArtistSongsForMultipleSelections(true);
          return playArtistSongs(true);
        }
      },
      {
        label: isMultipleSelectionsEnabled ? t(`common.addSongsToQueue`) : t(`common.addToQueue`),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            const { multipleSelections: artistIds } = multipleSelectionsData;
            return window.api.artistsData.getArtistData(artistIds).then((artists) => {
              const songIds = artists
                .map((artist) => artist.songs.map((song) => song.songId))
                .flat();
              const uniqueSongIds = [...new Set(songIds)];
              updateQueueData(undefined, [...queue.queue, ...uniqueSongIds], false);
              return addNewNotifications([
                {
                  id: `${uniqueSongIds.length}AddedToQueueFromMultiSelection`,
                  duration: 5000,
                  content: t(`notifications.addedToQueue`, {
                    count: uniqueSongIds.length
                  })
                }
              ]);
            });
          }
          updateQueueData(undefined, [...queue.queue, ...props.songIds], false, false);
          return addNewNotifications([
            {
              id: 'addSongsToQueue',
              duration: 5000,
              content: t(`notifications.addedToQueue`, {
                count: props.songIds.length
              })
            }
          ]);
        }
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t(
          `artist.${isMultipleSelectionEnabled ? 'toggleLikeArtists' : isAFavorite ? 'dislikeArtist' : 'likeArtist'}`
        ),
        iconName: 'favorite',
        iconClassName: isMultipleSelectionsEnabled
          ? 'ms-icon mr-4 text-xl'
          : isAFavorite
            ? 'ms-icon ms-icon-filled mr-4 text-xl'
            : 'ms-icon mr-4 text-xl',
        handlerFunction: () => {
          const { multipleSelections: artistIds } = multipleSelectionsData;

          return window.api.artistsData
            .toggleLikeArtists(isMultipleSelectionsEnabled ? artistIds : [props.artistId])
            .then((res) => {
              if (res && res.likes.length + res.dislikes.length > 0) {
                return setIsAFavorite((prevState) => {
                  const isLiked = res.likes.includes(props.artistId);
                  const isDisliked = res.dislikes.includes(props.artistId);

                  return isLiked ? true : isDisliked ? false : prevState;
                });
              }
              return undefined;
            })
            .catch((err) => console.error(err));
        }
      },
      {
        label: t(`common.info`),
        iconName: 'info',
        iconClassName: 'ms-icon',
        handlerFunction: goToArtistInfoPage,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            return updateMultipleSelections(
              props.artistId,
              'artist',
              isAMultipleSelection ? 'remove' : 'add'
            );
          }
          return toggleMultipleSelections(!isAMultipleSelection, 'artist', [props.artistId]);
        }
      }
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !props.selectAllHandler,
      //   handlerFunction: () =>
      //     props.selectAllHandler && props.selectAllHandler(),
      // },
    ] satisfies ContextMenuItem[];
  }, [
    multipleSelectionsData,
    isAMultipleSelection,
    t,
    isMultipleSelectionEnabled,
    isAFavorite,
    goToArtistInfoPage,
    playArtistSongsForMultipleSelections,
    playArtistSongs,
    updateQueueData,
    queue.queue,
    props.songIds,
    props.artistId,
    addNewNotifications,
    toggleMultipleSelections,
    updateMultipleSelections
  ]);

  const contextMenuItemData = useMemo(
    (): ContextMenuAdditionalData =>
      isMultipleSelectionEnabled &&
      multipleSelectionsData.selectionType === 'artist' &&
      isAMultipleSelection
        ? {
            title: t(`artist.selectedArtistCount`, {
              count: multipleSelectionsData.multipleSelections.length
            }),
            artworkPath: DefaultArtistCover
          }
        : {
            title: props.name,
            artworkPath:
              props?.onlineArtworkPaths?.picture_small || props?.artworkPaths?.optimizedArtworkPath,
            artworkClassName: '!rounded-full',
            subTitle: t(`common.songWithCount`, {
              count: props.songIds.length
            })
          },
    [
      isAMultipleSelection,
      isMultipleSelectionEnabled,
      multipleSelectionsData.multipleSelections.length,
      multipleSelectionsData.selectionType,
      props?.artworkPaths?.optimizedArtworkPath,
      props.name,
      props?.onlineArtworkPaths?.picture_small,
      props.songIds.length,
      t
    ]
  );

  return (
    <div
      className={`artist ${appearFromBottom && 'appear-from-bottom'} group mr-2 flex w-40 cursor-pointer flex-col items-center gap-2.5 rounded-panel p-3 transition-colors duration-150 hover:bg-surface-2/60 ${
        props.className
      } ${isAMultipleSelection ? '!bg-accent-soft' : ''}`}
      onContextMenu={(e) => {
        e.stopPropagation();
        updateContextMenuData(true, artistContextMenus, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        if (e.getModifierState('Shift') === true && props.selectAllHandler)
          props.selectAllHandler(props.artistId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'artist', [props.artistId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'artist')
          updateMultipleSelections(
            props.artistId,
            'artist',
            isAMultipleSelection ? 'remove' : 'add'
          );
        else goToArtistInfoPage();
      }}
    >
      <div className="artist-img-container relative aspect-square w-full">
        <Img
          src={props?.onlineArtworkPaths?.picture_medium}
          fallbackSrc={props.artworkPaths.artworkPath}
          alt=""
          className="aspect-square h-full w-full rounded-full bg-surface-2 object-cover shadow-[0_8px_22px_rgb(0_0_0/0.3)]"
          enableImgFadeIns={false}
        />
        {isAFavorite && (
          <span className="ms-icon ms-icon-filled absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-[15px] text-echo shadow-float">
            favorite
          </span>
        )}
        {isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'artist' && (
          <MultipleSelectionCheckbox
            id={props.artistId}
            selectionType="artist"
            className="absolute bottom-1 left-1 z-10"
          />
        )}
      </div>
      <button
        type="button"
        className="name-container block w-full truncate text-center text-body font-medium text-ink outline-none hover:underline focus-visible:underline"
        title={props.name === '' ? 'Unknown Artist' : props.name}
        onClick={(e) => {
          e.stopPropagation();
          goToArtistInfoPage();
        }}
      >
        {props.name === '' ? 'Unknown Artist' : props.name}
      </button>
    </div>
  );
};
