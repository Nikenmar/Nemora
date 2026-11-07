import { lazy, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ContinueHero from './ContinueHero';
import ForYouShelf from './ForYouShelf';
import MixOfTheDay from './MixOfTheDay';
import EmptyState from '../ui/EmptyState';
import { SkeletonTiles } from '../ui/Skeleton';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useResizeObserver from '../../hooks/useResizeObserver';

import roundTo from '../../../../common/roundTo';

import MainContainer from '../MainContainer';
import Button from '../Button';
import RecentlyAddedSongs from './RecentlyAddedSongs';
import RecentlyPlayedSongs from './RecentlyPlayedSongs';
import RecentlyPlayedArtists from './RecentlyPlayedArtists';
import MostLovedSongs from './MostLovedSongs';
import MostLovedArtists from './MostLovedArtists';

const ErrorPrompt = lazy(() => import('../ErrorPrompt'));
const AddMusicFoldersPrompt = lazy(() => import('../MusicFoldersPage/AddMusicFoldersPrompt'));


interface HomePageReducer {
  latestSongs: (AudioInfo | null)[];
  recentlyPlayedSongs: SongData[];
  recentSongArtists: Artist[];
  mostLovedSongs: AudioInfo[];
  mostLovedArtists: Artist[];
}

type HomePageReducerActionTypes =
  | 'SONGS_DATA'
  | 'RECENTLY_PLAYED_SONGS_DATA'
  | 'RECENT_SONGS_ARTISTS'
  | 'MOST_LOVED_ARTISTS'
  | 'MOST_LOVED_SONGS';

const reducer = (
  state: HomePageReducer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: { type: HomePageReducerActionTypes; data?: any }
): HomePageReducer => {
  switch (action.type) {
    case 'SONGS_DATA':
      return {
        ...state,
        latestSongs: action.data
      };
    case 'RECENTLY_PLAYED_SONGS_DATA':
      return {
        ...state,
        recentlyPlayedSongs: action.data
      };
    case 'RECENT_SONGS_ARTISTS':
      return {
        ...state,
        recentSongArtists: action.data
      };
    case 'MOST_LOVED_SONGS':
      return {
        ...state,
        mostLovedSongs: action.data
      };
    case 'MOST_LOVED_ARTISTS':
      return {
        ...state,
        mostLovedArtists: action.data
      };
    default:
      return state;
  }
};

/** The shelves rise in on the first Home of a session only (PLAN/14 A13), never on a return. */
let homeVisited = false;

const HomePage = () => {
  const [isFirstHomeOfSession] = useState(() => {
    const first = !homeVisited;
    homeVisited = true;
    return first;
  });
  const { updateContextMenuData, changePromptMenuData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [content, dispatch] = useReducer(reducer, {
    latestSongs: [],
    recentlyPlayedSongs: [],
    recentSongArtists: [],
    mostLovedSongs: [],
    mostLovedArtists: []
  });

  const SONG_CARD_MIN_WIDTH = 176;
  const ARTIST_WIDTH = 175;

  const recentlyAddedSongsContainerRef = useRef<HTMLDivElement>(null);
  const recentlyAddedSongsContainerDiamensions = useResizeObserver(recentlyAddedSongsContainerRef);
  const { noOfRecentlyAddedSongCards, noOfRecentandLovedArtists, noOfRecentandLovedSongCards } =
    useMemo(() => {
      const { width } = recentlyAddedSongsContainerDiamensions;

      return {
        noOfRecentlyAddedSongCards: Math.floor(width / SONG_CARD_MIN_WIDTH) || 5,
        noOfRecentandLovedSongCards: Math.floor(width / SONG_CARD_MIN_WIDTH) || 5,
        noOfRecentandLovedArtists: Math.floor(width / ARTIST_WIDTH) || 5
      };
    }, [recentlyAddedSongsContainerDiamensions]);

  const fetchLatestSongs = useCallback(() => {
    window.api.audioLibraryControls
      .getAllSongs('dateAddedAscending', undefined, {
        start: 0,
        end: noOfRecentlyAddedSongCards
      })
      .then((audioData) => {
        if (!audioData || audioData.data.length === 0)
          return dispatch({ type: 'SONGS_DATA', data: [null] });

        dispatch({
          type: 'SONGS_DATA',
          data: audioData.data
        });
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [noOfRecentlyAddedSongCards]);

  const fetchRecentlyPlayedSongs = useCallback(async () => {
    const recentSongs = await window.api.playlistsData
      .getPlaylistData(['History'])
      .catch((err) => console.error(err));
    if (
      Array.isArray(recentSongs) &&
      recentSongs.length > 0 &&
      Array.isArray(recentSongs[0].songs) &&
      recentSongs[0].songs.length > 0
    )
      window.api.audioLibraryControls
        .getSongInfo(
          recentSongs[0].songs,
          undefined,
          undefined,
          noOfRecentandLovedSongCards + 5,
          true
        )
        .then(
          (res) =>
            Array.isArray(res) &&
            dispatch({
              type: 'RECENTLY_PLAYED_SONGS_DATA',
              data: res
            })
        )
        .catch((err) => console.error(err));
  }, [noOfRecentandLovedSongCards]);

  const fetchRecentArtistsData = useCallback(() => {
    if (content.recentlyPlayedSongs.length > 0) {
      const artistIds = [
        ...new Set(
          content.recentlyPlayedSongs
            .map((song) => (song.artists ? song.artists.map((artist) => artist.artistId) : []))
            .flat()
        )
      ];

      if (artistIds.length > 0)
        window.api.artistsData
          .getArtistData(artistIds, undefined, undefined, noOfRecentandLovedArtists)
          .then(
            (res) =>
              Array.isArray(res) &&
              dispatch({
                type: 'RECENT_SONGS_ARTISTS',
                data: res
              })
          )
          .catch((err) => console.error(err));
    }
  }, [content.recentlyPlayedSongs, noOfRecentandLovedArtists]);

  // ? Most loved songs are fetched after the user have made at least one favorite song from the library.
  const fetchMostLovedSongs = useCallback(() => {
    window.api.playlistsData
      .getPlaylistData(['Favorites'])
      .then((res) => {
        if (Array.isArray(res) && res.length > 0) {
          return window.api.audioLibraryControls.getSongInfo(
            res[0].songs,
            'allTimeMostListened',
            undefined,
            noOfRecentandLovedSongCards + 5,
            true
          );
        }
        return undefined;
      })
      .then(
        (lovedSongs) =>
          Array.isArray(lovedSongs) &&
          lovedSongs.length > 0 &&
          dispatch({ type: 'MOST_LOVED_SONGS', data: lovedSongs })
      )
      .catch((err) => console.error(err));
  }, [noOfRecentandLovedSongCards]);

  const fetchMostLovedArtists = useCallback(() => {
    if (content.mostLovedSongs.length > 0) {
      const artistIds = [
        ...new Set(
          content.mostLovedSongs
            .map((song) => (song.artists ? song.artists.map((artist) => artist.artistId) : []))
            .flat()
        )
      ];
      window.api.artistsData
        .getArtistData(artistIds, undefined, undefined, noOfRecentandLovedArtists)
        .then(
          (res) =>
            Array.isArray(res) &&
            dispatch({
              type: 'MOST_LOVED_ARTISTS',
              data: res
            })
        )
        .catch((err) => console.error(err));
    }
  }, [content.mostLovedSongs, noOfRecentandLovedArtists]);

  useEffect(() => {
    console.log('fetchLatestSongs');
    fetchLatestSongs();
  }, [fetchLatestSongs]);

  useEffect(() => {
    console.log('fetchRecentlyPlayedSongs');
    fetchRecentlyPlayedSongs();
  }, [fetchRecentlyPlayedSongs]);

  useEffect(() => {
    console.log('fetchMostLovedSongs');
    fetchMostLovedSongs();
  }, [fetchMostLovedSongs]);

  useEffect(() => {
    const manageDataUpdatesInHomePage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (const event of dataEvents) {
          if (event.dataType === 'playlists/history') fetchRecentlyPlayedSongs();
          else if (
            event.dataType === 'songs/deletedSong' ||
            event.dataType === 'songs/updatedSong' ||
            event.dataType === 'songs/newSong' ||
            event.dataType === 'songs/palette' ||
            event.dataType === 'blacklist/songBlacklist' ||
            (event.dataType === 'songs/likes' && event.eventData.length > 1)
          ) {
            fetchLatestSongs();
            fetchRecentlyPlayedSongs();
            fetchMostLovedSongs();
          } else if (
            event.dataType === 'artists/artworks' ||
            event.dataType === 'artists/deletedArtist' ||
            event.dataType === 'artists/updatedArtist' ||
            event.dataType === 'artists/newArtist' ||
            (event.dataType === 'artists/likes' && event.eventData.length > 1)
          ) {
            fetchRecentArtistsData();
            fetchMostLovedArtists();
          } else if (
            event.dataType === 'songs/likes' ||
            event.dataType === 'songs/listeningData/listens'
          )
            fetchMostLovedSongs();
        }
      }
    };

    document.addEventListener('app/dataUpdates', manageDataUpdatesInHomePage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageDataUpdatesInHomePage);
    };
  }, [
    fetchLatestSongs,
    fetchMostLovedArtists,
    fetchMostLovedSongs,
    fetchRecentArtistsData,
    fetchRecentlyPlayedSongs
  ]);

  useEffect(() => fetchRecentArtistsData(), [fetchRecentArtistsData]);
  useEffect(() => fetchMostLovedArtists(), [fetchMostLovedArtists]);

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
              palette: song.paletteData,
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

  const homePageContextMenus: ContextMenuItem[] = useMemo(
    () =>
      window.api.properties.isInDevelopment
        ? [
            {
              label: 'Alert Error',
              iconName: 'report',
              handlerFunction: () =>
                changePromptMenuData(
                  true,
                  <ErrorPrompt
                    reason="JUST_FOR_FUN"
                    message={
                      <>
                        This prompt is used to develop the prompt menu. Instead of clicking doing
                        something that will open a prompt and also result in consequences, this
                        approach is much better because nothing will change when opening this
                        prompt.
                      </>
                    }
                    showSendFeedbackBtn
                  />,
                  'error-alert-prompt'
                )
            },
            {
              label: 'Show Notification',
              iconName: 'notifications_active',
              handlerFunction: () => {
                const duration = Math.random() * 10000;
                addNewNotifications([
                  {
                    id: duration.toString(),
                    duration: 5 * 60 * 1000,
                    // duration,
                    content: `This is a notification with a number ${roundTo(Math.random(), 2)}`,
                    iconName: 'notifications_active',
                    type: 'WITH_PROGRESS_BAR'
                  }
                ]);
              }
            }
          ]
        : [],
    [changePromptMenuData, addNewNotifications]
  );

  return (
    <MainContainer
      className={`home-page relative !h-full overflow-y-auto [scrollbar-gutter:stable] ${
        isFirstHomeOfSession ? 'home-stagger' : ''
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (homePageContextMenus.length > 0)
          updateContextMenuData(true, homePageContextMenus, e.pageX, e.pageY);
      }}
      ref={recentlyAddedSongsContainerRef}
    >
      <>
        {recentlyAddedSongsContainerRef.current && (
          <>
            {content.latestSongs[0] !== null && (
              // Today (PLAN/19 D1): what to resume and what to start fresh, side by side.
              <div className="today-row mb-8 mr-4 flex items-stretch gap-5 xl:flex-col">
                <ContinueHero lastPlayed={content.recentlyPlayedSongs[0]} isInRow />
                <MixOfTheDay />
              </div>
            )}
            {/* For you first: what is made for the user before the lists of what happened. */}
            {content.latestSongs[0] !== null && (
              <ForYouShelf noOfVisibleSongs={noOfRecentandLovedSongCards} />
            )}
            {content.latestSongs[0] !== null && (
              <RecentlyAddedSongs
                latestSongs={content.latestSongs as AudioInfo[]}
                noOfVisibleSongs={noOfRecentlyAddedSongCards}
              />
            )}
            <RecentlyPlayedSongs
              recentlyPlayedSongs={content.recentlyPlayedSongs.slice(
                0,
                noOfRecentandLovedSongCards
              )}
              noOfVisibleSongs={noOfRecentandLovedSongCards}
            />
            <MostLovedSongs
              mostLovedSongs={content.mostLovedSongs.slice(0, noOfRecentandLovedSongCards)}
              noOfVisibleSongs={noOfRecentandLovedSongCards}
            />
            <RecentlyPlayedArtists
              recentlyPlayedSongArtists={content.recentSongArtists}
              noOfVisibleArtists={noOfRecentandLovedArtists}
            />
            <MostLovedArtists
              mostLovedArtists={content.mostLovedArtists}
              noOfVisibleArtists={noOfRecentandLovedArtists}
            />
          </>
        )}

        {content.latestSongs[0] === null && (
          <EmptyState
            className="no-songs-container h-full"
            iconName="library_music"
            title={t('homePage.empty')}
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
        {content.recentlyPlayedSongs.length === 0 && content.latestSongs.length === 0 && (
          <div className="no-songs-container w-full pr-4 pt-2">
            <SkeletonTiles count={6} />
          </div>
        )}
        {content.latestSongs.length > 0 &&
          content.latestSongs[0] !== null &&
          content.recentlyPlayedSongs.length === 0 && (
            <EmptyState
              className="no-songs-container py-10"
              iconName="headphones"
              title={t('homePage.listenMoreToShowMetrics')}
            />
          )}
      </>
    </MainContainer>
  );
};

export default HomePage;
