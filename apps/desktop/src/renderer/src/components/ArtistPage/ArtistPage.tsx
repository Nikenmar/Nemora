import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import storage from '../../utils/localStorage';
import i18n from '../../i18n';

import { Artist } from './Artist';
import Dropdown, { type DropdownOption } from '../Dropdown';
import MainContainer from '../MainContainer';
import Img from '../Img';
import Button from '../Button';

import NoArtistImage from '../../assets/images/svg/Sun_Monochromatic.svg';
import VirtualizedGrid from '../VirtualizedGrid';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const artistSortOptions: DropdownOption<ArtistSortTypes>[] = [
  { label: i18n.t('sortTypes.aToZ'), value: 'aToZ' },
  { label: i18n.t('sortTypes.zToA'), value: 'zToA' },
  {
    label: i18n.t('sortTypes.noOfSongsDescending'),
    value: 'noOfSongsDescending'
  },
  {
    label: i18n.t('sortTypes.noOfSongsAscending'),
    value: 'noOfSongsAscending'
  },
  {
    label: i18n.t('sortTypes.mostLovedDescending'),
    value: 'mostLovedDescending'
  },
  {
    label: i18n.t('sortTypes.mostLovedAscending'),
    value: 'mostLovedAscending'
  }
];

const artistFilterOptions: DropdownOption<ArtistFilterTypes>[] = [
  { label: i18n.t('filterTypes.notSelected'), value: 'notSelected' },
  { label: i18n.t('filterTypes.favorites'), value: 'favorites' }
];

const MIN_ITEM_WIDTH = 175;
const MIN_ITEM_HEIGHT = 200;

const ArtistPage = () => {
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  const sortingStates = useStore(store, (state) => state.localStorage.sortingStates);

  const { updateCurrentlyActivePageData, toggleMultipleSelections } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [artistsData, setArtistsData] = useState([] as Artist[]);
  const [sortingOrder, setSortingOrder] = useState<ArtistSortTypes>(
    (currentlyActivePage?.data?.sortingOrder as ArtistSortTypes | undefined) ||
      sortingStates?.artistsPage ||
      'aToZ'
  );
  const [filteringOrder, setFilteringOrder] = useState<ArtistFilterTypes>('notSelected');

  const fetchArtistsData = useCallback(
    () =>
      window.api.artistsData.getArtistData([], sortingOrder, filteringOrder).then((res) => {
        if (res && Array.isArray(res)) {
          if (res.length > 0) return setArtistsData(res);
          return setArtistsData([]);
        }
        return undefined;
      }),
    [filteringOrder, sortingOrder]
  );

  useEffect(() => {
    fetchArtistsData();
    const manageArtistDataUpdatesInArtistsPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (event.dataType === 'artists/likes' && event.dataType.length > 1) fetchArtistsData();
          if (event.dataType === 'artists') fetchArtistsData();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageArtistDataUpdatesInArtistsPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageArtistDataUpdatesInArtistsPage);
    };
  }, [fetchArtistsData]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('artistsPage', sortingOrder);
  }, [sortingOrder]);

  const selectAllHandler = useSelectAllHandler(artistsData, 'artist', 'artistId');

  console.log('offset', currentlyActivePage?.data);
  return (
    <MainContainer
      className="appear-from-bottom artists-list-container !h-full overflow-hidden !pb-0"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        {artistsData.length > 0 && (
          <div className="title-container mb-5 mt-1 flex flex-col gap-3 pr-4 text-ink">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-page font-semibold text-ink">{t('common.artist_other')}</h1>
              <div className="other-stats-container flex items-center text-small text-ink-dim">
                {isMultipleSelectionEnabled &&
                multipleSelectionsData.multipleSelections.length > 0 ? (
                  <div className="text-small font-medium text-echo">
                    {t('common.selectionWithCount', {
                      count: multipleSelectionsData.multipleSelections.length
                    })}
                  </div>
                ) : (
                  artistsData &&
                  artistsData.length > 0 && (
                    <span className="no-of-artists">
                      {t('common.artistWithCount', {
                        count: artistsData.length
                      })}
                    </span>
                  )
                )}
              </div>
            </div>
            <div className="other-control-container flex">
              <Button
                label={t(`common.${isMultipleSelectionEnabled ? 'unselectAll' : 'select'}`)}
                className="select-btn !mr-0"
                iconName={isMultipleSelectionEnabled ? 'remove_done' : 'checklist'}
                clickHandler={() => toggleMultipleSelections(!isMultipleSelectionEnabled, 'artist')}
              />
              <Dropdown
                name="artistPageFilterDropdown"
                type={`${t('common.filterBy')} :`}
                value={filteringOrder}
                options={artistFilterOptions}
                onChange={(e) => {
                  updateCurrentlyActivePageData((currentPageData) => ({
                    ...currentPageData,
                    filteringOrder: e.currentTarget.value as ArtistFilterTypes
                  }));
                  setFilteringOrder(e.currentTarget.value as ArtistFilterTypes);
                }}
              />
              <Dropdown
                name="artistsSortDropdown"
                type={`${t('common.sortBy')} :`}
                value={sortingOrder}
                options={artistSortOptions}
                onChange={(e) => {
                  const artistSortType = e.currentTarget.value as ArtistSortTypes;
                  updateCurrentlyActivePageData((currentData) => ({
                    ...currentData,
                    sortingOrder: artistSortType
                  }));
                  setSortingOrder(artistSortType);
                }}
              />
            </div>
          </div>
        )}
        <div
          className={`artists-container flex !h-full flex-wrap ${!(artistsData && artistsData.length > 0) && 'hidden'}`}
        >
          {artistsData && artistsData.length > 0 && (
            <VirtualizedGrid
              data={artistsData}
              fixedItemWidth={MIN_ITEM_WIDTH}
              fixedItemHeight={MIN_ITEM_HEIGHT}
              scrollTopOffset={currentlyActivePage.data?.gridState as number | undefined}
              itemContent={(index, artist) => {
                return (
                  <Artist
                    index={index}
                    key={artist.artistId}
                    className="mb-4"
                    songIds={artist.songs.map((song) => song.songId)}
                    selectAllHandler={selectAllHandler}
                    appearFromBottom={false}
                    {...artist}
                  />
                );
              }}
            />
          )}
        </div>
        {/* {artistsData && artistsData.length === 0 && (
          <div className="no-songs-container my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl text-ink">
            <Img
              src={FetchingDataImage}
              alt="No songs available."
              className="mb-8 w-60"
            />
            <div>What about a Lemonade? They are cool, right ?</div>
          </div>
        )} */}
        {artistsData && artistsData.length === 0 && (
          <div className="no-songs-container my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl text-ink">
            <Img src={NoArtistImage} alt="Sun in a desert" className="mb-8 w-60" />
            <div>{t('artistsPage.empty')}</div>
          </div>
        )}
      </>
    </MainContainer>
  );
};

export default ArtistPage;
