import { getRuntime } from '../runtime';

export const genresData = {
  getGenresData: async (genreNamesOrIds?: string[], sortType?: GenreSortTypes): Promise<Genre[]> =>
    getRuntime().getGenres(genreNamesOrIds, sortType)
};
