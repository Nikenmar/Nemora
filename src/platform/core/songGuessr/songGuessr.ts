import {
  buildQueryVariants,
  buildTextKeys,
  normalizeSearchText,
  type SearchVariant
} from '../../../common/searchFolding';
import { scoreSearchValue } from '../../../common/searchScoring';
import { normalize } from '../playlists/pathUtils';
import { logger } from './logger';
import type { SongGuessrRepository } from './repository';

export const MINIMUM_SONG_GUESSR_DURATION = 15;
export const MINIMUM_POOL_SIZE_FOR_EXCLUSIONS = 10;
export const DEFAULT_SEARCH_LIMIT = 8;
/** Per request, not per query: later pages slice the complete cached ranking. */
export const MAX_SEARCH_PAGE_SIZE = 60;

const APP_PLAYLIST_IDS = new Set(['Favorites', 'History', 'Rediscover']);

interface SearchIndexEntry {
  song: SavableSongData;
  title: SearchVariant[];
  artists: SearchVariant[][];
  combined: SearchVariant[];
  index: number;
}

interface RankedSearchEntry {
  entry: SearchIndexEntry;
  score: number;
}

interface SearchCache {
  songs: SavableSongData[] | undefined;
  blacklistKey: string;
  index: SearchIndexEntry[];
  rankedByQuery: Map<string, SearchIndexEntry[]>;
}

type CatalogPoolType = Extract<SongGuessrPoolType, 'artist' | 'album'>;

interface CatalogPool {
  id: string;
  name: string;
  songs: SavableSongData[];
}

const caches = new WeakMap<SongGuessrRepository, SearchCache>();

const cacheFor = (repo: SongGuessrRepository): SearchCache => {
  const existing = caches.get(repo);
  if (existing) return existing;
  const created: SearchCache = {
    songs: undefined,
    blacklistKey: '',
    index: [],
    rankedByQuery: new Map()
  };
  caches.set(repo, created);
  return created;
};

const buildSearchKeys = (repo: SongGuessrRepository, value: string): SearchVariant[] =>
  buildTextKeys(value, repo.romanizeForSearch(value));

const getBlacklistKey = (blacklist: Blacklist): string =>
  `${blacklist.songBlacklist.join('\u0000')}\u0001${blacklist.folderBlacklist.join('\u0000')}`;

const isEligibleSong = (repo: SongGuessrRepository, song: SavableSongData): boolean => {
  if (
    !song ||
    typeof song.songId !== 'string' ||
    typeof song.path !== 'string' ||
    typeof song.duration !== 'number' ||
    !Number.isFinite(song.duration) ||
    song.duration < MINIMUM_SONG_GUESSR_DURATION
  ) {
    return false;
  }

  const blacklist = repo.getBlacklist();
  const isFolderBlacklisted = blacklist.folderBlacklist.some((folderPath) =>
    normalize(song.path).includes(normalize(folderPath))
  );
  return (
    !blacklist.songBlacklist.includes(song.songId) &&
    !isFolderBlacklisted &&
    repo.isSongAvailable(song.songId, song.path)
  );
};

const getEligibleSongs = (repo: SongGuessrRepository): SavableSongData[] =>
  repo.getSongs().filter((song) => isEligibleSong(repo, song));

const buildSongEntry = (repo: SongGuessrRepository, song: SavableSongData): SongGuessrEntry => ({
  songId: song.songId,
  title: song.title,
  artists: song.artists?.map((artist) => artist.name) ?? [],
  ...(song.album?.name ? { album: song.album.name } : {}),
  duration: song.duration,
  path: repo.resolveSongFilePath(song.path),
  artworkPaths: repo.getSongArtworkPath(song.songId, song.isArtworkAvailable)
});

const getSongIds = (songIds: unknown): Set<string> => {
  if (!Array.isArray(songIds)) return new Set();
  return new Set(songIds.filter((songId): songId is string => typeof songId === 'string'));
};

const getCatalogPools = (songs: SavableSongData[], poolType: CatalogPoolType): CatalogPool[] => {
  const pools = new Map<string, CatalogPool & { songIds: Set<string> }>();
  const addSong = (id: string, name: string, song: SavableSongData) => {
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      id.length === 0 ||
      name.trim().length === 0
    )
      return;

    const existing = pools.get(id) ?? { id, name, songs: [], songIds: new Set<string>() };
    if (!existing.songIds.has(song.songId)) {
      existing.songIds.add(song.songId);
      existing.songs.push(song);
    }
    pools.set(id, existing);
  };

  for (const song of songs) {
    if (poolType === 'artist') {
      for (const artist of song.artists ?? []) addSong(artist.artistId, artist.name, song);
    } else if (song.album) {
      addSong(song.album.albumId, song.album.name, song);
    }
  }

  return (
    [...pools.values()]
      // Reuse the established SongGuessr pool threshold: a catalogue should
      // have enough answers for recent-track avoidance to remain meaningful.
      .filter(({ songs: poolSongs }) => poolSongs.length >= MINIMUM_POOL_SIZE_FOR_EXCLUSIONS)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(({ id, name, songs: poolSongs }) => ({ id, name, songs: poolSongs }))
  );
};

const getSongsForPool = (
  repo: SongGuessrRepository,
  songs: SavableSongData[],
  poolType: SongGuessrPoolType,
  poolId?: string
): SavableSongData[] => {
  if (poolType === 'library') return songs;
  if (typeof poolId !== 'string' || poolId.length === 0) return [];

  if (poolType === 'playlist') {
    const playlist = repo.getPlaylists().find((entry) => entry.playlistId === poolId);
    if (!playlist) return [];
    const songIds = getSongIds(playlist.songs);
    return songs.filter((song) => songIds.has(song.songId));
  }

  if (poolType === 'artist' || poolType === 'album') {
    return getCatalogPools(songs, poolType).find((pool) => pool.id === poolId)?.songs ?? [];
  }

  if (poolType === 'genre') {
    const genre = repo.getGenres().find((entry) => entry.genreId === poolId);
    if (!genre) return [];
    const songIds = getSongIds(genre.songs?.map((song) => song.songId));
    return songs.filter((song) => songIds.has(song.songId));
  }

  return [];
};

const getSearchIndex = (repo: SongGuessrRepository): SearchIndexEntry[] => {
  const cache = cacheFor(repo);
  const songs = repo.getSongs();
  const blacklistKey = getBlacklistKey(repo.getBlacklist());

  if (songs !== cache.songs || blacklistKey !== cache.blacklistKey) {
    cache.songs = songs;
    cache.blacklistKey = blacklistKey;
    cache.index = songs
      .filter((song) => isEligibleSong(repo, song))
      .map((song, index) => {
        const artistNames = song.artists?.map((artist) => artist.name) ?? [];
        return {
          song,
          title: buildSearchKeys(repo, song.title),
          artists: artistNames.map((artist) => buildSearchKeys(repo, artist)),
          combined: buildSearchKeys(repo, [song.title, ...artistNames].join(' ')),
          index
        };
      });
    cache.rankedByQuery.clear();
  }

  return cache.index;
};

const scoreSearchKeys = (queryVariants: SearchVariant[], keys: SearchVariant[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const query of queryVariants) {
    for (const key of keys) {
      const score = scoreSearchValue(query.text, key.text) + query.penalty + key.penalty;
      if (score < best) best = score;
    }
  }
  return best;
};

const scoreSearchEntry = (queryVariants: SearchVariant[], entry: SearchIndexEntry): number => {
  let best = scoreSearchKeys(queryVariants, entry.title);
  for (const artist of entry.artists) {
    const score = scoreSearchKeys(queryVariants, artist) + 1;
    if (score < best) best = score;
  }
  const combinedScore = scoreSearchKeys(queryVariants, entry.combined) + 2;
  return combinedScore < best ? combinedScore : best;
};

const compareRankedEntries = (left: RankedSearchEntry, right: RankedSearchEntry): number =>
  left.score - right.score || left.entry.index - right.entry.index;

const getRankedMatches = (
  repo: SongGuessrRepository,
  normalizedQuery: string,
  rawQuery: string
): SearchIndexEntry[] => {
  const index = getSearchIndex(repo);
  const cache = cacheFor(repo);
  const cached = cache.rankedByQuery.get(normalizedQuery);
  if (cached) return cached;

  const queryVariants = buildQueryVariants(rawQuery);
  const matches: RankedSearchEntry[] = [];
  for (const entry of index) {
    const score = scoreSearchEntry(queryVariants, entry);
    if (Number.isFinite(score)) matches.push({ entry, score });
  }
  matches.sort(compareRankedEntries);
  const ranked = matches.map((match) => match.entry);
  cache.rankedByQuery.set(normalizedQuery, ranked);
  return ranked;
};

const buildCandidate = (
  repo: SongGuessrRepository,
  entry: SearchIndexEntry
): SongGuessrCandidate => ({
  songId: entry.song.songId,
  title: entry.song.title,
  artists: entry.song.artists?.map((artist) => artist.name) ?? [],
  // The optimized copy is only 50 px; use the full cover on scaled displays.
  artworkPath: repo.getSongArtworkPath(entry.song.songId, entry.song.isArtworkAvailable).artworkPath
});

export const getSongGuessrRound = (
  repo: SongGuessrRepository,
  options: SongGuessrRoundOptions
): SongGuessrRound | null => {
  try {
    if (
      !options ||
      (options.poolType !== 'library' &&
        options.poolType !== 'playlist' &&
        options.poolType !== 'genre' &&
        options.poolType !== 'artist' &&
        options.poolType !== 'album')
    ) {
      return null;
    }

    const eligibleSongs = getEligibleSongs(repo);
    const poolSongs = getSongsForPool(repo, eligibleSongs, options.poolType, options.poolId);
    if (poolSongs.length === 0) return null;

    const excludedSongIds = getSongIds(options.excludedSongIds);
    const nonExcludedSongs = poolSongs.filter((song) => !excludedSongIds.has(song.songId));
    const songsToChooseFrom =
      nonExcludedSongs.length >= MINIMUM_POOL_SIZE_FOR_EXCLUSIONS ? nonExcludedSongs : poolSongs;
    const randomIndex = Math.min(
      songsToChooseFrom.length - 1,
      Math.floor(repo.random() * songsToChooseFrom.length)
    );
    const answer = songsToChooseFrom[randomIndex];
    if (!answer) return null;
    return { answer: buildSongEntry(repo, answer), poolSize: poolSongs.length };
  } catch (error) {
    logger.error('Failed to build a SongGuessr round.', { error });
    return null;
  }
};

export const searchSongGuessrCandidates = (
  repo: SongGuessrRepository,
  query: string,
  limit = DEFAULT_SEARCH_LIMIT,
  offset = 0
): SongGuessrSearchResult => {
  const emptyResult: SongGuessrSearchResult = { candidates: [], total: 0 };
  try {
    if (typeof query !== 'string' || query.trim().length === 0) return emptyResult;
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length === 0) return emptyResult;

    const requestedLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.floor(limit)
        : DEFAULT_SEARCH_LIMIT;
    const pageSize = Math.min(Math.max(requestedLimit, 0), MAX_SEARCH_PAGE_SIZE);
    const start =
      typeof offset === 'number' && Number.isFinite(offset) ? Math.max(Math.floor(offset), 0) : 0;
    const matches = getRankedMatches(repo, normalizedQuery, query);
    if (pageSize === 0) return { candidates: [], total: matches.length };
    return {
      candidates: matches
        .slice(start, start + pageSize)
        .map((entry) => buildCandidate(repo, entry)),
      total: matches.length
    };
  } catch (error) {
    logger.error('Failed to search SongGuessr candidates.', { error });
    return emptyResult;
  }
};

export const getSongGuessrPools = (repo: SongGuessrRepository): SongGuessrPoolOption[] => {
  try {
    const eligibleSongs = getEligibleSongs(repo);
    const eligibleSongIds = new Set(eligibleSongs.map((song) => song.songId));
    const countEligibleSongIds = (songIds: unknown): number => {
      let count = 0;
      for (const songId of getSongIds(songIds)) {
        if (eligibleSongIds.has(songId)) count += 1;
      }
      return count;
    };

    const pools: SongGuessrPoolOption[] = [
      { type: 'library', name: 'library', count: eligibleSongs.length }
    ];
    for (const playlist of repo.getPlaylists()) {
      if (APP_PLAYLIST_IDS.has(playlist.playlistId)) continue;
      const count = countEligibleSongIds(playlist.songs);
      if (count >= MINIMUM_POOL_SIZE_FOR_EXCLUSIONS) {
        pools.push({ type: 'playlist', id: playlist.playlistId, name: playlist.name, count });
      }
    }
    for (const genre of repo.getGenres()) {
      const count = countEligibleSongIds(genre.songs?.map((song) => song.songId));
      if (count >= MINIMUM_POOL_SIZE_FOR_EXCLUSIONS) {
        pools.push({ type: 'genre', id: genre.genreId, name: genre.name, count });
      }
    }
    for (const poolType of ['artist', 'album'] as const) {
      for (const pool of getCatalogPools(eligibleSongs, poolType)) {
        pools.push({ type: poolType, id: pool.id, name: pool.name, count: pool.songs.length });
      }
    }
    return pools;
  } catch (error) {
    logger.error('Failed to get SongGuessr pools.', { error });
    return [];
  }
};
