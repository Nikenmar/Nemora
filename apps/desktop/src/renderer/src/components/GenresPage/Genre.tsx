/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useCallback, useContext, useMemo } from 'react';
import { coverGlow } from '../../other/coverLight';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Img from '../Img';
import DefaultGenreCover from '../../assets/images/webp/genre-cover-default.webp';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import { store } from '@renderer/store';
import { useStore } from '@tanstack/react-store';

interface GenreProp {
  index: number;
  genreId: string;
  title: string;
  songIds: string[];
  artworkPaths: ArtworkPaths;
  paletteData?: PaletteData;
  className?: string;
  selectAllHandler?: (_upToId?: string) => void;
}

const Genre = (props: GenreProp) => {
  const { genreId, songIds, title, artworkPaths, paletteData, className, selectAllHandler } = props;
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const queue = useStore(store, (state) => state.localStorage.queue);

  const {
    changeCurrentActivePage,
    createQueue,
    updateQueueData,
    addNewNotifications,
    updateContextMenuData,
    toggleMultipleSelections,
    updateMultipleSelections
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const goToGenreInfoPage = useCallback(
    () =>
      changeCurrentActivePage('GenreInfo', {
        genreId
      }),
    [changeCurrentActivePage, genreId]
  );

  // The cover's colour brought into the palette, as the cover light does (other/coverLight.ts).
  const backgroundColor = useMemo(() => coverGlow(paletteData) ?? 'rgb(var(--surface-2))', [paletteData]);

  const playGenreSongs = useCallback(
    (isShuffle = false) => {
      return window.api.audioLibraryControls
        .getSongInfo(songIds, undefined, undefined, undefined, true)
        .then((songs) => {
          if (Array.isArray(songs))
            return createQueue(
              songs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
              'genre',
              isShuffle,
              genreId,
              true
            );
          return undefined;
        });
    },
    [createQueue, genreId, songIds]
  );

  const playGenreSongsForMultipleSelections = useCallback(
    (isShuffle = false) => {
      const { multipleSelections: genreIds } = multipleSelectionsData;
      window.api.genresData
        .getGenresData(genreIds)
        .then((genres) => {
          if (Array.isArray(genres) && genres.length > 0) {
            const genreSongIds = genres
              .map((genre) => genre.songs.map((song) => song.songId))
              .flat();

            return window.api.audioLibraryControls.getSongInfo(
              genreSongIds,
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
    const { multipleSelections: genreIds } = multipleSelectionsData;
    window.api.genresData
      .getGenresData(genreIds)
      .then((genres) => {
        if (Array.isArray(genres) && genres.length > 0) {
          const genreSongIds = genres.map((genre) => genre.songs.map((song) => song.songId)).flat();

          return window.api.audioLibraryControls.getSongInfo(
            genreSongIds,
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

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'genre') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === genreId))
      return true;
    return false;
  }, [multipleSelectionsData, genreId]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'genre' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    return [
      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playAll' : 'play'}`),
        iconName: 'play_arrow',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) playGenreSongsForMultipleSelections();
          else playGenreSongs();
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t(`common.shuffleAndPlayAll`)
          : t(`common.shuffleAndPlay`),
        iconName: 'shuffle',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) playGenreSongsForMultipleSelections(true);
          else playGenreSongs(true);
        }
      },
      {
        label: t(`common.addToQueue`),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) addToQueueForMultipleSelections();
          else {
            queue.queue.push(...songIds);
            updateQueueData(undefined, queue.queue);
            addNewNotifications([
              {
                id: 'newSongsToQueue',
                duration: 5000,
                content: t(`notifications.addedToQueue`, {
                  count: songIds.length
                })
              }
            ]);
          }
        }
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            return updateMultipleSelections(
              genreId,
              'genre',
              isAMultipleSelection ? 'remove' : 'add'
            );
          }
          return toggleMultipleSelections(!isAMultipleSelection, 'genre', [genreId]);
        }
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !selectAllHandler,
      //   handlerFunction: () => selectAllHandler && selectAllHandler(),
      // },
      {
        label: t(`common.info`),
        iconName: 'info',
        iconClassName: 'ms-icon',
        handlerFunction: goToGenreInfoPage,
        isDisabled: isMultipleSelectionsEnabled
      }
    ];
  }, [
    multipleSelectionsData.selectionType,
    multipleSelectionsData.multipleSelections.length,
    isAMultipleSelection,
    t,
    goToGenreInfoPage,
    playGenreSongsForMultipleSelections,
    playGenreSongs,
    toggleMultipleSelections,
    addToQueueForMultipleSelections,
    queue.queue,
    songIds,
    updateQueueData,
    addNewNotifications,
    isMultipleSelectionEnabled,
    genreId,
    updateMultipleSelections
  ]);

  const contextMenuItemData = useMemo(
    () =>
      isMultipleSelectionEnabled &&
      multipleSelectionsData.selectionType === 'genre' &&
      isAMultipleSelection
        ? {
            title: t(`genre.selectedGenreCount`, {
              count: multipleSelectionsData.multipleSelections.length
            }),
            artworkPath: DefaultGenreCover
          }
        : {
            title,
            artworkPath: artworkPaths?.optimizedArtworkPath,
            subTitle: t('common.songWithCount', { count: songIds.length })
          },
    [
      artworkPaths?.optimizedArtworkPath,
      isAMultipleSelection,
      isMultipleSelectionEnabled,
      multipleSelectionsData.multipleSelections.length,
      multipleSelectionsData.selectionType,
      songIds.length,
      t,
      title
    ]
  );

  return (
    <div
      className={`genre group relative mb-6 mr-6 flex h-32 w-72 cursor-pointer items-center gap-4 overflow-hidden rounded-panel p-4 text-on-media transition-shadow duration-150 ${className} ${
        isAMultipleSelection ? 'ring-2 ring-echo ring-offset-2 ring-offset-canvas' : ''
      }`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${backgroundColor}, color-mix(in srgb, ${backgroundColor} 55%, black))`
      }}
      onClick={(e) => {
        if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(genreId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'genre', [genreId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'genre')
          updateMultipleSelections(genreId, 'genre', isAMultipleSelection ? 'remove' : 'add');
        else goToGenreInfoPage();
      }}
      onContextMenu={(e) =>
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData)
      }
    >
      <Img
        src={artworkPaths.artworkPath}
        className="aspect-square w-[5.5rem] shrink-0 rounded-cover object-cover shadow-[0_10px_24px_rgb(0_0_0/0.4)] transition-transform duration-300 ease-out group-hover:-rotate-2 group-hover:scale-[1.03]"
        alt=""
        enableImgFadeIns={!isMultipleSelectionEnabled}
      />
      <div className="genre-info-container min-w-0 flex-1">
        <button
          type="button"
          className="genre-title block w-full truncate text-left text-[17px] font-semibold text-on-media outline-none hover:underline focus-visible:underline"
          title={title}
          onClick={(e) => {
            e.stopPropagation();
            goToGenreInfoPage();
          }}
        >
          {title}
        </button>
        <div className="genre-no-of-songs mt-0.5 text-small text-on-media/70">
          {t(`common.songWithCount`, {
            count: songIds.length
          })}
        </div>
        {isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'genre' && (
          <MultipleSelectionCheckbox id={genreId} selectionType="genre" className="z-10 !mt-2" />
        )}
      </div>
    </div>
  );
};

export default Genre;
