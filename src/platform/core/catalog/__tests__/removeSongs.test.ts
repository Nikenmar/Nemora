import { describe, expect, jest, test } from '@jest/globals';

import { deleteSongsFromSystem } from '../deleteSongs';
import { removeSongReferencesFromDuels } from '../duels';
import { removeSongsFromCatalogState, removeSongsFromLibrary } from '../removeSongs';
import type { CatalogRepository, CatalogState } from '../repository';

const song = (songId: string, path: string): SavableSongData => ({
  songId,
  path,
  title: songId,
  duration: 120,
  artists: [{ artistId: 'artist', name: 'Artist' }],
  album: { albumId: 'album', name: 'Album' },
  genres: [{ genreId: 'genre', name: 'Genre' }],
  isAFavorite: songId === 'remove-me',
  isArtworkAvailable: true,
  addedDate: 1
});

const state = (): CatalogState => ({
  songs: [
    song('remove-me', 'E:\\Music\\remove.flac'),
    song('keep-me', 'E:\\Music\\keep.flac')
  ],
  artists: [
    {
      artistId: 'artist',
      name: 'Artist',
      isAFavorite: false,
      artworkName: 'remove-me.webp',
      songs: [
        { songId: 'remove-me', title: 'remove-me' },
        { songId: 'keep-me', title: 'keep-me' }
      ],
      albums: [{ albumId: 'album', title: 'Album' }]
    }
  ],
  albums: [
    {
      albumId: 'album',
      title: 'Album',
      artworkName: 'remove-me.webp',
      artists: [{ artistId: 'artist', name: 'Artist' }],
      songs: [
        { songId: 'remove-me', title: 'remove-me' },
        { songId: 'keep-me', title: 'keep-me' }
      ]
    }
  ],
  genres: [
    {
      genreId: 'genre',
      name: 'Genre',
      artworkName: 'remove-me.webp',
      songs: [
        { songId: 'remove-me', title: 'remove-me' },
        { songId: 'keep-me', title: 'keep-me' }
      ]
    }
  ],
  playlists: [
    {
      playlistId: 'Favorites',
      name: 'Favorites',
      songs: ['remove-me', 'keep-me'],
      createdDate: new Date(0),
      isArtworkAvailable: false
    },
    {
      playlistId: 'History',
      name: 'History',
      songs: ['remove-me'],
      createdDate: new Date(0),
      isArtworkAvailable: false
    }
  ],
  userData: { musicFolders: [] } as unknown as UserData,
  listeningData: [
    { songId: 'remove-me', listens: [] },
    { songId: 'keep-me', listens: [] }
  ],
  blacklist: { songBlacklist: ['remove-me', 'keep-me'], folderBlacklist: [] },
  tierlists: [
    {
      tierlistId: 'tierlist',
      name: 'Tierlist',
      createdDate: new Date(0),
      sourcePlaylistIds: ['Favorites'],
      tiers: [{ tierId: 's', name: 'S', items: ['remove-me', 'keep-me'] }],
      labelMode: 'track'
    }
  ],
  cmrStats: {
    elo: {
      ratings: {
        'remove-me': { rating: 1300, games: 1, wins: 1, losses: 0 },
        'keep-me': { rating: 1100, games: 1, wins: 0, losses: 1 }
      },
      history: [
        {
          at: 1,
          songAId: 'remove-me',
          songBId: 'keep-me',
          winner: 'A',
          deltaA: 10,
          deltaB: -10
        }
      ],
      totalDuels: 1
    },
    importedStatsExportIds: [],
    duelMatchmaking: {
      skippedPairs: [
        { at: 1, songAId: 'remove-me', songBId: 'keep-me', reason: 'cantDecide' }
      ]
    }
  }
});

describe('catalog song removal', () => {
  test('leaves no dangling playlist, tierlist, listening, ELO, or blacklist references', () => {
    const result = removeSongsFromCatalogState(state(), ['E:\\Music\\remove.flac']);

    expect(result.removedSongs.map((entry) => entry.songId)).toEqual(['remove-me']);
    expect(result.state.songs.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(result.state.playlists.map((playlist) => playlist.songs)).toEqual([['keep-me'], []]);
    expect(result.state.tierlists[0].tiers[0].items).toEqual(['keep-me']);
    expect(result.state.listeningData.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(result.state.blacklist.songBlacklist).toEqual(['keep-me']);
    expect(result.state.cmrStats.elo.ratings).not.toHaveProperty('remove-me');
    expect(result.state.cmrStats.elo.history).toEqual([]);
    expect(result.state.cmrStats.duelMatchmaking?.skippedPairs).toEqual([]);
    expect(result.state.artists[0].songs.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(result.state.albums[0].songs.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(result.state.genres[0].songs.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(result.state.artists[0].artworkName).toBe('keep-me.webp');
  });

  test('keeps listening history that knows which track it belongs to', () => {
    const source = state();
    // The row a current build writes: it carries the track's identity, so it can
    // find its way back if the same music is scanned again.
    source.listeningData = [
      {
        songId: 'remove-me',
        listens: [{ year: 2026, listens: [[1_770_000_000_000, 300]] }],
        fullListens: 300,
        fingerprint: {
          songId: 'remove-me',
          title: 'Removed Song',
          artists: ['Artist'],
          duration: 200,
          fileName: 'remove.flac'
        }
      },
      // A row from before fingerprints existed: nothing could ever reattach it,
      // so keeping it would only be dead weight.
      { songId: 'keep-me', listens: [] }
    ];

    const result = removeSongsFromCatalogState(source, ['E:\\Music\\remove.flac']);

    const kept = result.state.listeningData.find((entry) => entry.songId === 'remove-me');
    expect(kept?.fullListens).toBe(300);
    expect(result.state.songs.map((entry) => entry.songId)).toEqual(['keep-me']);
  });

  test('uses trash for recycle requests and never falls back to permanent deletion', async () => {
    let current = state();
    const repository: CatalogRepository = {
      getCatalogState: () => current,
      commitCatalogState: (next) => {
        current = next;
      },
      removeSongArtwork: async () => undefined,
      removeDuelQueueReferences: jest.fn(),
      emitDataUpdate: jest.fn(),
      sendMessage: jest.fn(),
      reportError: jest.fn()
    };
    const permanentlyDelete = jest.fn(async () => undefined);
    const moveToTrash = jest.fn(async () => {
      throw new Error('native trash command unavailable');
    });

    await expect(
      deleteSongsFromSystem(
        repository,
        { permanentlyDelete, moveToTrash },
        ['E:\\Music\\remove.flac'],
        false
      )
    ).resolves.toEqual({ success: false });

    expect(moveToTrash).toHaveBeenCalledWith('E:\\Music\\remove.flac');
    expect(permanentlyDelete).not.toHaveBeenCalled();
    expect(current.songs.map((entry) => entry.songId)).toContain('remove-me');
  });

  test('removes deleted songs from pending duel queues and synchronizes the badge', () => {
    const result = removeSongReferencesFromDuels(
      {
        frequency: 'normal',
        lastInviteAt: 0,
        listensSinceInvite: 2,
        pendingDuels: 2,
        pendingDuelTickets: [
          { anchorSongId: 'remove-me', earnedAt: 1 },
          { anchorSongId: 'keep-me', earnedAt: 2 }
        ],
        duelAnchorCandidates: [
          { songId: 'remove-me', listenedAt: 1 },
          { songId: 'keep-me', listenedAt: 2 }
        ],
        pendingDuelPairs: [
          ['remove-me', 'keep-me'],
          ['keep-me', 'other']
        ]
      },
      new Set(['remove-me'])
    );

    expect(result.pendingDuels).toBe(1);
    expect(result.pendingDuelTickets).toEqual([{ anchorSongId: 'keep-me', earnedAt: 2 }]);
    expect(result.duelAnchorCandidates).toEqual([{ songId: 'keep-me', listenedAt: 2 }]);
    expect(result.pendingDuelPairs).toEqual([['keep-me', 'other']]);
  });

  test('commits the catalog and prunes renderer-local duel references together', async () => {
    let current = state();
    const removeDuelQueueReferences = jest.fn();
    const repository: CatalogRepository = {
      getCatalogState: () => current,
      commitCatalogState: (next) => {
        current = next;
      },
      removeSongArtwork: async () => undefined,
      removeDuelQueueReferences,
      emitDataUpdate: jest.fn(),
      sendMessage: jest.fn(),
      reportError: jest.fn()
    };

    await removeSongsFromLibrary(repository, ['E:\\Music\\remove.flac']);

    expect(current.songs.map((entry) => entry.songId)).toEqual(['keep-me']);
    expect(removeDuelQueueReferences).toHaveBeenCalledWith(['remove-me']);
  });
});
