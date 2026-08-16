import { afterEach, describe, expect, test } from '@jest/globals';

import { configureLogger } from '../logger';
import type { SongGuessrRepository } from '../repository';
import {
  getSongGuessrPools,
  getSongGuessrRound,
  MAX_SEARCH_PAGE_SIZE,
  searchSongGuessrCandidates
} from '../songGuessr';

const artwork = (songId: string): ArtworkPaths => ({
  isDefaultArtwork: false,
  artworkPath: `nemora://covers/${songId}.webp`,
  optimizedArtworkPath: `nemora://covers/${songId}-optimized.webp`
});

const song = (index: number, overrides: Partial<SavableSongData> = {}): SavableSongData => ({
  songId: `song-${index}`,
  title: `Track ${String(index).padStart(3, '0')}`,
  duration: 180,
  artists: [{ artistId: `artist-${index}`, name: `Artist ${index}` }],
  isAFavorite: false,
  isArtworkAvailable: true,
  path: `C:\\Music\\song-${index}.flac`,
  addedDate: index,
  ...overrides
});

class FakeRepository implements SongGuessrRepository {
  songs: SavableSongData[];
  blacklist: Blacklist = { songBlacklist: [], folderBlacklist: [] };
  playlists: SavablePlaylist[] = [];
  genres: SavableGenre[] = [];
  unavailable = new Set<string>();
  randomValue = 0;
  availabilityChecks = 0;

  constructor(songs: SavableSongData[]) {
    this.songs = songs;
  }

  getSongs(): SavableSongData[] {
    return this.songs;
  }

  getBlacklist(): Blacklist {
    return this.blacklist;
  }

  getPlaylists(): SavablePlaylist[] {
    return this.playlists;
  }

  getGenres(): SavableGenre[] {
    return this.genres;
  }

  isSongAvailable(songId: string): boolean {
    this.availabilityChecks += 1;
    return !this.unavailable.has(songId);
  }

  resolveSongFilePath(path: string): string {
    return `nemora://localfiles/${encodeURIComponent(path)}`;
  }

  getSongArtworkPath(songId: string): ArtworkPaths {
    return artwork(songId);
  }

  romanizeForSearch(): string | undefined {
    return undefined;
  }

  random(): number {
    return this.randomValue;
  }
}

afterEach(() => configureLogger(undefined));

describe('SongGuessr rounds', () => {
  test('chooses uniformly from the non-recent set while ten answers remain', () => {
    const repo = new FakeRepository(Array.from({ length: 20 }, (_, index) => song(index)));
    const excludedSongIds = Array.from({ length: 10 }, (_, index) => `song-${index}`);

    const round = getSongGuessrRound(repo, { poolType: 'library', excludedSongIds });

    expect(round?.answer.songId).toBe('song-10');
    expect(round?.poolSize).toBe(20);
    expect(round?.answer.path).toContain('nemora://localfiles/');
  });

  test('falls back to the whole pool when fewer than ten non-recent answers remain', () => {
    const repo = new FakeRepository(Array.from({ length: 12 }, (_, index) => song(index)));
    const excludedSongIds = Array.from({ length: 11 }, (_, index) => `song-${index}`);

    expect(getSongGuessrRound(repo, { poolType: 'library', excludedSongIds })?.answer.songId).toBe(
      'song-0'
    );
  });

  test('rejects short, blacklisted, unavailable, and invalid tracks', () => {
    const repo = new FakeRepository([
      song(0),
      song(1, { duration: 14.99 }),
      song(2),
      song(3),
      song(4, { duration: Number.NaN })
    ]);
    repo.blacklist.songBlacklist.push('song-2');
    repo.unavailable.add('song-3');

    const round = getSongGuessrRound(repo, { poolType: 'library' });

    expect(round?.answer.songId).toBe('song-0');
    expect(round?.poolSize).toBe(1);
  });

  test('limits artist and album rounds to the selected catalogue', () => {
    const catalogue = Array.from({ length: 20 }, (_, index) =>
      song(index, {
        artists: [
          {
            artistId: index < 10 ? 'artist-a' : 'artist-b',
            name: index < 10 ? 'Artist A' : 'Artist B'
          }
        ],
        album: {
          albumId: index < 10 ? 'album-a' : 'album-b',
          name: index < 10 ? 'Album A' : 'Album B'
        }
      })
    );
    const repo = new FakeRepository(catalogue);

    expect(
      getSongGuessrRound(repo, { poolType: 'artist', poolId: 'artist-b' })?.answer.songId
    ).toBe('song-10');
    expect(getSongGuessrRound(repo, { poolType: 'album', poolId: 'album-b' })?.poolSize).toBe(10);
  });

  test('refuses an artist or album catalogue below the qualifying pool size', () => {
    const repo = new FakeRepository(
      Array.from({ length: 9 }, (_, index) =>
        song(index, {
          artists: [{ artistId: 'small-artist', name: 'Small Artist' }],
          album: { albumId: 'small-album', name: 'Small Album' }
        })
      )
    );

    expect(getSongGuessrRound(repo, { poolType: 'artist', poolId: 'small-artist' })).toBeNull();
    expect(getSongGuessrRound(repo, { poolType: 'album', poolId: 'small-album' })).toBeNull();
  });
});

describe('SongGuessr autocomplete', () => {
  test('pages the whole ranking and caps only the current request at sixty', () => {
    const repo = new FakeRepository(
      Array.from({ length: 80 }, (_, index) => song(index, { title: `Halo ${index}` }))
    );

    const first = searchSongGuessrCandidates(repo, 'halo', 500, 0);
    const second = searchSongGuessrCandidates(repo, 'halo', 500, MAX_SEARCH_PAGE_SIZE);

    expect(first.total).toBe(80);
    expect(first.candidates).toHaveLength(60);
    expect(second.total).toBe(80);
    expect(second.candidates).toHaveLength(20);
    expect(
      new Set([...first.candidates, ...second.candidates].map(({ songId }) => songId)).size
    ).toBe(80);
  });

  test('ranks a title match ahead of an artist-only and combined match', () => {
    const repo = new FakeRepository([
      song(0, { title: 'Other', artists: [{ artistId: 'halo', name: 'Halo' }] }),
      song(1, { title: 'Halo', artists: [{ artistId: 'other', name: 'Other' }] }),
      song(2, { title: 'The', artists: [{ artistId: 'artist', name: 'Halo Artist' }] })
    ]);

    const result = searchSongGuessrCandidates(repo, 'halo');

    expect(result.candidates.map(({ songId }) => songId)).toEqual(['song-1', 'song-0', 'song-2']);
  });

  test('reuses the index across queries and pages, then rebuilds on blacklist change', () => {
    const repo = new FakeRepository(Array.from({ length: 12 }, (_, index) => song(index)));

    searchSongGuessrCandidates(repo, 'track', 4, 0);
    searchSongGuessrCandidates(repo, 'track', 4, 4);
    searchSongGuessrCandidates(repo, 'artist', 4, 0);
    expect(repo.availabilityChecks).toBe(12);

    repo.blacklist.songBlacklist.push('song-0');
    const rebuilt = searchSongGuessrCandidates(repo, 'track', 20, 0);
    expect(rebuilt.total).toBe(11);
    expect(repo.availabilityChecks).toBe(23);
  });

  test('rebuilds when the songs array identity changes', () => {
    const repo = new FakeRepository([song(0)]);
    expect(searchSongGuessrCandidates(repo, 'track').total).toBe(1);
    repo.songs = [...repo.songs, song(1)];
    expect(searchSongGuessrCandidates(repo, 'track').total).toBe(2);
    expect(repo.availabilityChecks).toBe(3);
  });

  test('normalizes empty inputs and reports total for a zero-sized page', () => {
    const repo = new FakeRepository([song(0)]);
    expect(searchSongGuessrCandidates(repo, '  ')).toEqual({ candidates: [], total: 0 });
    expect(searchSongGuessrCandidates(repo, 'track', 0)).toEqual({ candidates: [], total: 1 });
  });
});

describe('SongGuessr pools and failure behavior', () => {
  test('includes qualifying user pools, excludes app playlists, and counts unique eligible ids', () => {
    const songs = Array.from({ length: 12 }, (_, index) => song(index));
    const repo = new FakeRepository(songs);
    const tenIds = songs.slice(0, 10).map(({ songId }) => songId);
    repo.playlists = [
      {
        playlistId: 'Favorites',
        name: 'Favorites',
        songs: tenIds,
        createdDate: new Date(0),
        isArtworkAvailable: true
      },
      {
        playlistId: 'road-trip',
        name: 'Road Trip',
        songs: [...tenIds, tenIds[0]],
        createdDate: new Date(0),
        isArtworkAvailable: false
      }
    ];
    repo.genres = [
      {
        genreId: 'rock',
        name: 'Rock',
        songs: tenIds.map((songId) => ({ songId, title: songId }))
      }
    ];

    expect(getSongGuessrPools(repo)).toEqual([
      { type: 'library', name: 'library', count: 12 },
      { type: 'playlist', id: 'road-trip', name: 'Road Trip', count: 10 },
      { type: 'genre', id: 'rock', name: 'Rock', count: 10 }
    ]);
  });

  test('reports qualifying artist and album catalogues in stable name order', () => {
    const repo = new FakeRepository(
      Array.from({ length: 20 }, (_, index) =>
        song(index, {
          artists: [
            {
              artistId: index < 10 ? 'artist-z' : 'artist-a',
              name: index < 10 ? 'Zed Artist' : 'Alpha Artist'
            }
          ],
          album: {
            albumId: index < 10 ? 'album-z' : 'album-a',
            name: index < 10 ? 'Zed Album' : 'Alpha Album'
          }
        })
      )
    );

    expect(getSongGuessrPools(repo).slice(1)).toEqual([
      { type: 'artist', id: 'artist-a', name: 'Alpha Artist', count: 10 },
      { type: 'artist', id: 'artist-z', name: 'Zed Artist', count: 10 },
      { type: 'album', id: 'album-a', name: 'Alpha Album', count: 10 },
      { type: 'album', id: 'album-z', name: 'Zed Album', count: 10 }
    ]);
  });

  test('does not offer undersized artist or album catalogues after eligibility filtering', () => {
    const repo = new FakeRepository(
      Array.from({ length: 11 }, (_, index) =>
        song(index, {
          duration: index === 10 ? 14 : 180,
          artists: [{ artistId: 'artist', name: 'Artist' }],
          album: { albumId: 'album', name: 'Album' }
        })
      )
    );

    expect(getSongGuessrPools(repo)).toEqual([
      { type: 'library', name: 'library', count: 10 },
      { type: 'artist', id: 'artist', name: 'Artist', count: 10 },
      { type: 'album', id: 'album', name: 'Album', count: 10 }
    ]);

    repo.blacklist.songBlacklist.push('song-0');
    expect(getSongGuessrPools(repo)).toEqual([{ type: 'library', name: 'library', count: 9 }]);
  });

  test('fails closed and reports repository errors through the logger seam', () => {
    const errors: Array<{ message: string; data?: Record<string, unknown> }> = [];
    configureLogger({ error: (message, data) => errors.push({ message, data }) });
    const repo = new FakeRepository([]);
    repo.getSongs = () => {
      throw new Error('catalog unavailable');
    };

    expect(getSongGuessrRound(repo, { poolType: 'library' })).toBeNull();
    expect(searchSongGuessrCandidates(repo, 'track')).toEqual({ candidates: [], total: 0 });
    expect(getSongGuessrPools(repo)).toEqual([]);
    expect(errors).toHaveLength(3);
  });
});
