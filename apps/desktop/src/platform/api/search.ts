import { getRuntime } from '../runtime';

export const search = {
  search: async (
    filter: SearchFilters,
    value: string,
    updateSearchHistory?: boolean
  ): Promise<SearchResult> => getRuntime().search(filter, value, updateSearchHistory),
  clearSearchHistory: async (searchText?: string[]): Promise<boolean> =>
    getRuntime().clearSearchHistory(searchText)
};
