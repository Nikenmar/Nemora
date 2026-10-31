import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import RecentSearchResult from './RecentSearchResult';


type Props = {
  searchInput: string;
  searchResults: SearchResult;

  updateSearchInput: (input: string) => void;
};

const SearchStartPlaceholder = (props: Props) => {
  const { updateCurrentlyActivePageData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { searchInput, updateSearchInput } = props;

  const [recentSearchResults, setRecentSearchResults] = useState([] as string[]);

  const fetchRecentSearchResults = useCallback(() => {
    window.api.userData
      .getUserData()
      .then((data) => {
        if (data && Array.isArray(data.recentSearches))
          return setRecentSearchResults(data.recentSearches);
        return undefined;
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    fetchRecentSearchResults();
    const manageSearchResultsUpdatesInSearchPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (event.dataType === 'userData/recentSearches') fetchRecentSearchResults();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    };
  }, [fetchRecentSearchResults]);

  useEffect(() => fetchRecentSearchResults(), [fetchRecentSearchResults]);

  const recentSearchResultComponents = useMemo(
    () =>
      recentSearchResults.length > 0
        ? recentSearchResults.map((result, index) => (
            <RecentSearchResult
              key={index}
              result={result}
              clickHandler={() => {
                updateSearchInput(result);
                updateCurrentlyActivePageData((currentData) => ({
                  ...currentData,
                  keyword: result
                }));
              }}
            />
          ))
        : [],
    [recentSearchResults, updateCurrentlyActivePageData, updateSearchInput]
  );

  return (
    <>
      {searchInput.trim() === '' && (
        <div className="search-start-placeholder active appear-from-bottom relative flex !h-full w-full flex-col items-center justify-center text-center">
          <span className="ms-icon mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-[28px] text-ink-dim" aria-hidden>
            search
          </span>

          <div className="description text-section font-semibold text-ink">
            {t('searchPage.searchForAnythingInLibrary')}
          </div>
          <div className="recent-search-results-container mt-4 flex w-[clamp(12.5rem,90%,50rem)] flex-wrap items-center justify-center">
            {recentSearchResultComponents}
          </div>
          {recentSearchResultComponents.length > 0 && (
            <Button
              label="clear search history"
              className="!m-0 !mt-4 !rounded-none !border-0 !p-0 !text-echo outline-1 outline-offset-1 hover:underline focus-visible:!outline"
              clickHandler={(_, setIsDisabled) => {
                setIsDisabled(true);
                window.api.search.clearSearchHistory().catch((err) => {
                  setIsDisabled(false);
                  console.warn(err);
                });
              }}
              pendingAnimationOnDisabled
              pendingClassName="mr-2"
            />
          )}
        </div>
      )}
    </>
  );
};

export default SearchStartPlaceholder;
