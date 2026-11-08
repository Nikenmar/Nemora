import { lazy, useCallback, useContext, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import storage from '../../utils/localStorage';

import Song from './Song';
import Button from '../Button';
import MainContainer from '../MainContainer';
import TitleContainer from '../TitleContainer';
import EmptyState from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';
import VirtualizedList from '../VirtualizedList';

import { songSortOptions, songFilterOptions } from './SongOptions';

import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { SONG_ROW_HEIGHT } from './songRowHeight';

const AddMusicFoldersPrompt = lazy(() => import('../MusicFoldersPage/AddMusicFoldersPrompt'));

interface SongPageReducer {
  songsData: AudioInfo[];
  sortingOrder: SongSortTypes;
  filteringOrder: SongFilterTypes;
}

type SongPageReducerActionTypes = 'SONGS_DATA' | 'SORTING_ORDER' | 'FILTERING_ORDER';

const reducer = (
  state: SongPageReducer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: { type: SongPageReducerActionTypes; data: any }
): SongPageReducer => {
  switch (action.type) {
    case 'SONGS_DATA':
      return {
        ...state,
        songsData: action.data
      };
    case 'SORTING_ORDER':
      return {
        ...state,
        sortingOrder: action.data
      };
    case 'FILTERING_ORDER':
      return {
        ...state,
        filteringOrder: action.data
      };
    default:
      return state;
  }
};

const SongsPage = () => {
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  const localStorageData = useStore(store, (state) => state.localStorage);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    createQueue,
    playSong,
    updateCurrentlyActivePageData,
    toggleMultipleSelections,
    changePromptMenuData
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [content, dispatch] = useReducer(reducer, {
    songsData: [],
    sortingOrder:
      (currentlyActivePage?.data?.sortingOrder as SongSortTypes) ||
      localStorageData?.sortingStates?.songsPage ||
      'aToZ',
    filteringOrder: 'notSelected'
  });

  const fetchSongsData = useCallback(() => {
    console.time('songs');

    window.api.audioLibraryControls
      .getAllSongs(content.sortingOrder, content.filteringOrder)
      .then((audioInfoArray) => {
        console.timeEnd('songs');

        if (audioInfoArray) {
          if (audioInfoArray.data.length === 0)
            dispatch({
              type: 'SONGS_DATA',
              data: null
            });
          else
            dispatch({
              type: 'SONGS_DATA',
              data: audioInfoArray.data
            });
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [content.filteringOrder, content.sortingOrder]);

  useEffect(() => {
    fetchSongsData();
    const manageSongsDataUpdatesInSongsPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (
            event.dataType === 'songs/deletedSong' ||
            event.dataType === 'songs/newSong' ||
            event.dataType === 'blacklist/songBlacklist' ||
            (event.dataType === 'songs/likes' && event.eventData.length > 1)
          )
            fetchSongsData();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageSongsDataUpdatesInSongsPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageSongsDataUpdatesInSongsPage);
    };
  }, [fetchSongsData]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('songsPage', content.sortingOrder);
  }, [content.sortingOrder]);

  const addNewSongs = useCallback(() => {
    changePromptMenuData(
      true,
      <AddMusicFoldersPrompt
        onSuccess={(songs) => {
          const relevantSongsData: AudioInfo[] = songs.map((song) => {
            return {
              title: song.title,
              songId: song.songId,
              artists: song.artists,
              duration: song.duration,
              path: song.path,
              artworkPaths: song.artworkPaths,
              addedDate: song.addedDate,
              isAFavorite: song.isAFavorite,
              isBlacklisted: song.isBlacklisted
            };
          });
          dispatch({ type: 'SONGS_DATA', data: relevantSongsData });
        }}
        onFailure={() => dispatch({ type: 'SONGS_DATA', data: [null] })}
      />
    );
  }, [changePromptMenuData]);

  const selectAllHandler = useSelectAllHandler(content.songsData, 'songs', 'songId');

  const handleSongPlayBtnClick = useCallback(
    (currSongId: string) => {
      const queueSongIds = content.songsData
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.songId);
      createQueue(queueSongIds, 'songs', false, undefined, false);
      playSong(currSongId, true);
    },
    [content.songsData, createQueue, playSong]
  );

  // const parentRef = useRef<HTMLDivElement>(null);

  // const rowVirtualizer = useVirtualizer({
  //   count: content.songsData?.length || 0,
  //   getScrollElement: () => parentRef.current,
  //   estimateSize: () => 60,
  //   overscan: 10,
  //   debug: true
  // });

  return (
    <MainContainer
      className="main-container appear-from-bottom songs-list-container !h-full overflow-hidden !pb-0"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        {content.songsData && content.songsData.length > 0 && (
          <TitleContainer
            title={t('common.song_other')}
            otherItems={[
              isMultipleSelectionEnabled && multipleSelectionsData.multipleSelections.length > 0 ? (
                <span key="meta" className="text-small font-medium text-echo">
                  {t('common.selectionWithCount', {
                    count: multipleSelectionsData.multipleSelections.length
                  })}
                </span>
              ) : (
                <span key="meta" className="no-of-songs text-small text-ink-dim">
                  {t('common.songWithCount', { count: content.songsData.length })}
                </span>
              )
            ]}
            buttons={[
              {
                label: t('common.playAll'),
                iconName: 'play_arrow',
                variant: 'primary',
                className: 'play-all-btn',
                clickHandler: () =>
                  createQueue(
                    content.songsData.filter((song) => !song.isBlacklisted).map((song) => song.songId),
                    'songs',
                    false,
                    undefined,
                    true
                  )
              },
              {
                label: t('common.shuffleAndPlay'),
                iconName: 'shuffle',
                className: 'shuffle-and-play-all-btn',
                clickHandler: () =>
                  createQueue(
                    content.songsData.filter((song) => !song.isBlacklisted).map((song) => song.songId),
                    'songs',
                    true,
                    undefined,
                    true
                  )
              },
              {
                iconName: isMultipleSelectionEnabled ? 'remove_done' : 'checklist',
                className: 'select-btn',
                isActive: isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs',
                tooltipLabel: t(
                  `common.${
                    isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs'
                      ? 'unselectAll'
                      : 'select'
                  }`
                ),
                clickHandler: () => toggleMultipleSelections(!isMultipleSelectionEnabled, 'songs')
              },
              {
                label: t('settingsPage.resyncLibrary'),
                iconName: 'sync',
                inOverflowMenu: true,
                clickHandler: () => window.api.audioLibraryControls.resyncSongsLibrary()
              }
            ]}
            dropdowns={[
              {
                name: 'songsPageFilterDropdown',
                type: `${t('common.filterBy')} :`,
                value: content.filteringOrder,
                options: songFilterOptions,
                onChange: (e) => {
                  updateCurrentlyActivePageData((currentPageData) => ({
                    ...currentPageData,
                    filteringOrder: e.currentTarget.value as SongFilterTypes
                  }));
                  dispatch({ type: 'FILTERING_ORDER', data: e.currentTarget.value });
                }
              },
              {
                name: 'songsPageSortDropdown',
                type: `${t('common.sortBy')} :`,
                value: content.sortingOrder,
                options: songSortOptions,
                onChange: (e) => {
                  updateCurrentlyActivePageData((currentPageData) => ({
                    ...currentPageData,
                    sortingOrder: e.currentTarget.value as SongSortTypes
                  }));
                  dispatch({ type: 'SORTING_ORDER', data: e.currentTarget.value });
                }
              }
            ]}
          />
        )}
        <div
          className="songs-container appear-from-bottom h-full flex-1 delay-100"
          // ref={songsContainerRef}
        >
          {/* <InfiniteLoader
            // isItemLoaded={isItemLoaded}
            itemCount={60}
            // loadMoreItems={loadMoreItems}
          >
            {({ onItemsRendered, ref }) => (
              <List
                ref={ref}
                onItemsRendered={onItemsRendered}
                itemCount={content.songsData.length}
                itemSize={60}
                width={width || '100%'}
                height={height || 450}
                overscanCount={10}
                className="appear-from-bottom delay-100"
                initialScrollOffset={
                  currentlyActivePage.data?.scrollTopOffset ?? 0
                }
                onScroll={(data) => {
                  if (!data.scrollUpdateWasRequested && data.scrollOffset !== 0)
                    debounce(
                      () =>
                        updateCurrentlyActivePageData((currentPageData) => ({
                          ...currentPageData,
                          scrollTopOffset: data.scrollOffset,
                        })),
                      500,
                    );
                }}
              >
                {songs}
              </List>
            )}
          </InfiniteLoader> */}
          {content.songsData && content.songsData.length > 0 && (
            <VirtualizedList
              data={content.songsData}
              fixedItemHeight={SONG_ROW_HEIGHT}
              scrollTopOffset={currentlyActivePage.data?.scrollTopOffset}
              itemContent={(index, song) => {
                if (song)
                  return (
                    <Song
                      key={index}
                      index={index}
                      isIndexingSongs={localStorageData?.preferences.isSongIndexingEnabled}
                      onPlayClick={handleSongPlayBtnClick}
                      selectAllHandler={selectAllHandler}
                      {...song}
                    />
                  );
                return <div>Bad Index</div>;
              }}
            />
          )}
        </div>
        {content.songsData && content.songsData.length === 0 && (
          <div className="no-songs-container w-full pt-2">
            <SkeletonRows count={10} />
          </div>
        )}
        {content.songsData === null && (
          <EmptyState
            className="no-songs-container"
            iconName="library_music"
            title={t('songsPage.empty')}
            action={
              <Button
                label={t('foldersPage.addFolder')}
                iconName="create_new_folder"
                variant="primary"
                className="!mr-0"
                clickHandler={addNewSongs}
              />
            }
          />
        )}
      </>
    </MainContainer>
  );
};

export default SongsPage;
