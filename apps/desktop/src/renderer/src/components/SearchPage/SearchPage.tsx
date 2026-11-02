/* eslint-disable jsx-a11y/no-autofocus */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useResizeObserver from '../../hooks/useResizeObserver';
import i18n from '../../i18n';

import SearchResultsFilter, { type SearchResultFilter } from './SearchResultsFilter';
import MainContainer from '../MainContainer';
import GenreSearchResultsContainer from './Result_Containers/GenreSearchResultsContainer';
import PlaylistSearchResultsContainer from './Result_Containers/PlaylistSearchResultsContainer';
import AlbumSearchResultsContainer from './Result_Containers/AlbumSearchResultsContainer';
import SongSearchResultsContainer from './Result_Containers/SongSearchResultsContainer';
import LyricsSearchResultsContainer from './Result_Containers/LyricsSearchResultsContainer';
import MostRelevantSearchResultsContainer from './Result_Containers/MostRelevantSearchResultsContainer';
import ArtistsSearchResultsContainer from './Result_Containers/ArtistsSearchResultsContainer';
import NoSearchResultsContainer from './NoSearchResultsContainer';
import SearchStartPlaceholder from './SearchStartPlaceholder';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const searchFilter: SearchResultFilter[] = [
  { label: i18n.t('searchPage.allFilter'), icon: 'select_all', value: 'All' },
  { label: i18n.t('common.song_other'), icon: 'music_note', value: 'Songs' },
  { label: i18n.t('common.album_other'), icon: 'people', value: 'Albums' },
  { label: i18n.t('common.artist_other'), icon: 'album', value: 'Artists' },
  {
    label: i18n.t('common.playlist_other'),
    icon: 'track_changes',
    value: 'Playlists'
  },
  { label: i18n.t('common.genre_other'), icon: 'queue_music', value: 'Genres' }
];
const ARTIST_WIDTH = 175;
const ALBUM_WIDTH = 210;
const PLAYLIST_WIDTH = 160;
const GENRE_WIDTH = 300;

const SearchPage = () => {
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);

  const { updateCurrentlyActivePageData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [searchInput, setSearchInput] = useState(
    (currentlyActivePage?.data?.keyword as string) || ''
  );
  // The top bar writes the keyword into the page's data as the user types.
  const pageKeyword = (currentlyActivePage?.data?.keyword as string) || '';
  useEffect(() => setSearchInput(pageKeyword), [pageKeyword]);

  const searchContainerRef = useRef(null);
  const { width } = useResizeObserver(searchContainerRef);

  const [searchResults, setSearchResults] = useState({
    albums: [],
    artists: [],
    songs: [],
    playlists: [],
    genres: [],
    availableResults: []
  } as SearchResult);
  const [activeFilter, setActiveFilter] = useState('All' as SearchFilters);

  const { noOfArtists, noOfPlaylists, noOfAlbums, noOfGenres } = useMemo(() => {
    return {
      noOfPlaylists: Math.floor(width / PLAYLIST_WIDTH) || 4,
      noOfArtists: Math.floor(width / ARTIST_WIDTH) || 5,
      noOfAlbums: Math.floor(width / ALBUM_WIDTH) || 4,
      noOfGenres: Math.floor(width / GENRE_WIDTH) || 3
    };
  }, [width]);

  const changeActiveFilter = useCallback(
    (filterType: SearchFilters) => setActiveFilter(filterType),
    []
  );

  const filters = searchFilter.map((filter) => {
    return (
      <SearchResultsFilter
        key={filter.value}
        label={filter.label}
        icon={filter.icon}
        value={filter.value}
        isCurrentActiveFilter={filter.value === activeFilter}
        changeActiveFilter={changeActiveFilter}
      />
    );
  });

  const timeOutIdRef = useRef(undefined as ReturnType<typeof setTimeout> | undefined);
  const fetchSearchResults = useCallback(() => {
    if (searchInput.trim() !== '') {
      if (timeOutIdRef.current) clearTimeout(timeOutIdRef.current);
      timeOutIdRef.current = setTimeout(
        () =>
          window.api.search.search(activeFilter, searchInput, true).then((results) => {
            return setSearchResults(results);
          }),
        250
      );
    } else
      setSearchResults({
        albums: [],
        artists: [],
        songs: [],
        playlists: [],
        genres: [],
        availableResults: []
      });
  }, [activeFilter, searchInput, timeOutIdRef]);

  useEffect(() => {
    fetchSearchResults();
    const manageSearchResultsUpdatesInSearchPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (
            event.dataType === 'songs' ||
            event.dataType === 'artists' ||
            event.dataType === 'albums' ||
            event.dataType === 'playlists/newPlaylist' ||
            event.dataType === 'playlists/deletedPlaylist' ||
            event.dataType === 'genres/newGenre' ||
            event.dataType === 'genres/deletedGenre' ||
            event.dataType === 'blacklist/songBlacklist'
          )
            fetchSearchResults();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    };
  }, [fetchSearchResults]);

  // A recent search or a suggestion fills the top bar's field through the page's keyword.
  const updateSearchInput = useCallback(
    (input: string) => updateCurrentlyActivePageData((data) => ({ ...data, keyword: input })),
    [updateCurrentlyActivePageData]
  );

  return (
    <MainContainer className="!h-full !pb-0 [scrollbar-gutter:stable]" ref={searchContainerRef}>
      <div className="search-controls-container">
        {/* The query comes from the field in the top bar (TitleBar/TitleBarSearch). */}
        <div className="mb-4 mt-1 flex items-baseline gap-3">
          <h1 className="text-page font-semibold text-ink">{t('sideBar.search')}</h1>
          <span
            className="ms-icon cursor-help text-[18px] text-ink-dim"
            data-tooltip={t('searchPage.separateKeywords')}
            aria-label={t('searchPage.separateKeywords')}
          >
            help
          </span>
        </div>
        {/* SEARCH FILTERS */}
        <div className="search-filters-container mb-6">
          <ul className="flex flex-wrap items-center gap-2">{filters}</ul>
        </div>
      </div>
      <div className="search-results-container relative !h-full">
        {/* MOST RELEVANT SEARCH RESULTS */}
        <MostRelevantSearchResultsContainer searchResults={searchResults} />
        {/* SONG SEARCH RESULTS */}
        <SongSearchResultsContainer songs={searchResults.songs} searchInput={searchInput} />
        {/* LYRICS: songs with a matching line (PLAN/19 D6) */}
        {(activeFilter === 'All' || activeFilter === 'Songs') && (
          <LyricsSearchResultsContainer searchInput={searchInput} />
        )}
        {/* ARTIST SEARCH RESULTS */}
        <ArtistsSearchResultsContainer
          artists={searchResults.artists}
          searchInput={searchInput}
          noOfVisibleArtists={noOfArtists}
        />
        {/* ALBUM SEARCH RESULTS */}
        <AlbumSearchResultsContainer
          albums={searchResults.albums}
          searchInput={searchInput}
          noOfVisibleAlbums={noOfAlbums}
        />
        {/* PLAYLIST SEARCH RESULTS */}
        <PlaylistSearchResultsContainer
          playlists={searchResults.playlists}
          searchInput={searchInput}
          noOfVisiblePlaylists={noOfPlaylists}
        />
        {/* GENRE SEARCH RESULTS */}
        <GenreSearchResultsContainer
          genres={searchResults.genres}
          searchInput={searchInput}
          noOfVisibleGenres={noOfGenres}
        />
        {/* NO SEARCH RESULTS PLACEHOLDER */}
        <NoSearchResultsContainer
          searchInput={searchInput}
          searchResults={searchResults}
          updateSearchInput={updateSearchInput}
        />
        {/* SEARCH START PLACEHOLDER */}
        <SearchStartPlaceholder
          searchResults={searchResults}
          searchInput={searchInput}
          updateSearchInput={updateSearchInput}
        />
      </div>
    </MainContainer>
  );
};

export default SearchPage;
