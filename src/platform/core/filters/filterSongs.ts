import type { BlacklistRepository } from './repository';

function filterSongs<T extends (SavableSongData | SongData)[]>(
  repository: BlacklistRepository,
  data: T,
  filterType?: SongFilterTypes
): T {
  if (data && data.length > 0 && filterType) {
    if (filterType === 'notSelected') return data;

    if (filterType === 'blacklistedSongs')
      return data.filter((song) => repository.isSongBlacklisted(song.songId, song.path)) as T;
    if (filterType === 'whitelistedSongs')
      return data.filter((song) => !repository.isSongBlacklisted(song.songId, song.path)) as T;
  }

  return data;
}

export default filterSongs;
