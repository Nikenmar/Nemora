import { noOpLogger, type SearchRepository } from './repository';

const clearSearchHistoryResults = (
  repository: SearchRepository,
  resultsToRemove: string[] = []
): boolean => {
  const log = repository.log ?? noOpLogger;
  log.debug(
    `User request to remove ${
      resultsToRemove.length > 0 ? resultsToRemove.length : 'all'
    } results from the search history.`
  );
  const recentSearches = repository.getRecentSearches();
  if (Array.isArray(recentSearches)) {
    if (recentSearches.length === 0) return true;
    if (resultsToRemove.length === 0) repository.setRecentSearches([]);
    else {
      const updatedRecentSearches = recentSearches.filter(
        (recentSearch) => !resultsToRemove.some((result) => recentSearch === result)
      );
      repository.setRecentSearches(updatedRecentSearches);
    }
  }
  repository.notifyDataUpdated('userData/recentSearches');
  log.debug('Finished the cleaning process of the search history.');
  return true;
};

export default clearSearchHistoryResults;
