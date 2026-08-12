import { describe, expect, test } from '@jest/globals';

import {
  importCollections,
  isValidExportPreferences,
  isValidExportedPlaylist
} from '../importCollections';
import { createMockTransferRepo, createPlaylist, createTierlist } from './testUtils';

const MATCHES = new Map([
  ['f1', 'l1'],
  ['f2', 'l2'],
  ['f3', 'l3']
]);

/** Fixture helper: exports serialize createdDate to an ISO string, so parseDate must accept both. */
const foreignPlaylist = (
  playlistId: string,
  name: string,
  songs: string[],
  createdDate: string
): ExportedPlaylist => ({
  playlistId,
  name,
  songs,
  createdDate: createdDate as unknown as Date
});

const baseExport = (overrides: Partial<StatsExportFile> = {}): StatsExportFile => ({
  format: 'nora-cmr-stats-export',
  formatVersion: 1,
  exportId: 'exp-1',
  exportedAt: '',
  appVersion: '',
  songs: [],
  listeningData: [],
  ...overrides
});

describe('importCollections', () => {
  test('merges playlists by name as a union and remaps foreign song ids', () => {
    const repo = createMockTransferRepo(undefined, {
      playlists: [createPlaylist('local-1', { name: 'Road Trip', songs: ['l1'] })]
    });

    const result = importCollections(
      repo,
      baseExport({
        playlists: [
          foreignPlaylist('foreign-1', 'Road Trip', ['f1', 'f2'], '2024-05-05T00:00:00.000Z')
        ]
      }),
      MATCHES
    );

    expect(result).toEqual({ playlistsImported: 1, tierlistsImported: 0, notes: [] });
    const merged = repo.state.playlists.find((playlist) => playlist.name === 'Road Trip');
    expect(merged?.playlistId).toBe('local-1');
    expect(merged?.songs).toEqual(['l1', 'l2']);
    // Playlists are written exactly once, at the end.
    expect(repo.events.filter((event) => event === 'setPlaylistData')).toHaveLength(1);
  });

  test('creates a new playlist with a fresh local id when the name is unknown', () => {
    const repo = createMockTransferRepo(undefined, { playlists: [] });

    const result = importCollections(
      repo,
      baseExport({
        playlists: [foreignPlaylist('foreign-2', 'New Mix', ['f1'], '2024-01-01')]
      }),
      MATCHES
    );

    expect(result.playlistsImported).toBe(1);
    const created = repo.state.playlists[0];
    expect(created).toBeDefined();
    expect(created?.name).toBe('New Mix');
    expect(created?.songs).toEqual(['l1']);
    expect(created?.playlistId).not.toBe('foreign-2');
    expect(created?.createdDate).toEqual(new Date('2024-01-01'));
  });

  test('notes songs that did not match and never creates system playlists', () => {
    const repo = createMockTransferRepo(undefined, { playlists: [] });

    const result = importCollections(
      repo,
      baseExport({
        playlists: [
          foreignPlaylist('p1', 'Favorites', ['f1'], '2024-01-01'),
          foreignPlaylist('p2', 'Rediscover', ['f1'], '2024-01-01'),
          foreignPlaylist('p3', 'HISTORY', ['f1'], '2024-01-01'),
          foreignPlaylist('p4', 'Partial', ['f1', 'f9'], '2024-01-01')
        ]
      }),
      MATCHES
    );

    expect(result.playlistsImported).toBe(1);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        "Playlist 'Favorites' is app-managed here - skipped.",
        "Playlist 'Rediscover' is app-managed here - skipped.",
        "Playlist 'HISTORY' is app-managed here - skipped.",
        "Playlist 'Partial': 1 song(s) not found in this library."
      ])
    );
    const names = repo.state.playlists.map((playlist) => playlist.name);
    expect(names).toEqual(['Partial']);
  });

  test('imports tierlists whole with fresh ids and skips same-name tierlists', () => {
    const repo = createMockTransferRepo(undefined, {
      playlists: [createPlaylist('local-1', { name: 'Road Trip', songs: ['l1'] })],
      tierlists: [createTierlist('local-t1', { name: 'Top Picks' })]
    });

    const result = importCollections(
      repo,
      baseExport({
        playlists: [foreignPlaylist('foreign-1', 'Road Trip', ['f1', 'f2'], '2024-01-01')],
        tierlists: [
          // Same name as an existing tierlist — skipped, never merged.
          createTierlist('foreign-t1', {
            name: 'Top Picks',
            sourcePlaylistIds: ['foreign-1'],
            tiers: [{ tierId: 'r1', name: 'S', items: ['f1'] }]
          }),
          createTierlist('foreign-t2', {
            name: 'Fresh Board',
            createdDate: new Date('2024-02-02T00:00:00.000Z'),
            sourcePlaylistIds: ['foreign-1'],
            tiers: [
              { tierId: 'r2', name: 'S', items: ['f1', 'f2'] },
              { tierId: 'r3', name: 'A', items: ['f3'] }
            ]
          })
        ]
      }),
      MATCHES
    );

    expect(result).toMatchObject({ playlistsImported: 1, tierlistsImported: 1 });
    expect(result.notes).toContain("Tierlist 'Top Picks' already exists — skipped.");

    const imported = repo.state.tierlists.find((tierlist) => tierlist.name === 'Fresh Board');
    expect(imported).toBeDefined();
    // Fresh ids everywhere, source playlist remapped to the local id.
    expect(imported?.tierlistId).not.toBe('foreign-t2');
    expect(imported?.sourcePlaylistIds).toEqual(['local-1']);
    expect(imported?.tiers[0]?.tierId).not.toBe('r2');
    expect(imported?.tiers[0]?.items).toEqual(['l1', 'l2']);
    expect(imported?.tiers[1]?.items).toEqual(['l3']);
    expect(imported?.createdDate).toEqual(new Date('2024-02-02T00:00:00.000Z'));

    // Both playlists and tierlists are written once.
    expect(repo.events.filter((event) => event === 'setPlaylistData')).toHaveLength(1);
    expect(repo.events.filter((event) => event === 'setTierlistData')).toHaveLength(1);
    expect(repo.emitDataUpdateMock).toHaveBeenCalledWith('tierlists/newTierlist');
  });

  test('replaces dropped folder sources with an "Imported: <name>" fallback playlist', () => {
    const repo = createMockTransferRepo(undefined, { playlists: [] });

    const result = importCollections(
      repo,
      baseExport({
        tierlists: [
          createTierlist('foreign-t1', {
            name: 'Folder Board',
            sourcePlaylistIds: [],
            sourceFolderPaths: ['E:\\Other Machine\\Music'],
            tiers: [{ tierId: 'r1', name: 'S', items: ['f1', 'f3'] }]
          })
        ]
      }),
      MATCHES
    );

    expect(result.tierlistsImported).toBe(1);
    expect(result.notes).toContain(
      "Tierlist 'Folder Board': folder sources replaced with playlist 'Imported: Folder Board'."
    );
    const fallback = repo.state.playlists.find(
      (playlist) => playlist.name === 'Imported: Folder Board'
    );
    expect(fallback?.songs).toEqual(['l1', 'l3']);
    const imported = repo.state.tierlists[0];
    expect(imported?.sourcePlaylistIds).toEqual([fallback?.playlistId]);
    expect(imported?.sourceFolderPaths).toEqual([]);
  });

  test('notes dropped folder sources when nothing matched', () => {
    const repo = createMockTransferRepo(undefined, { playlists: [] });

    const result = importCollections(
      repo,
      baseExport({
        tierlists: [
          createTierlist('foreign-t1', {
            name: 'Empty Board',
            sourcePlaylistIds: [],
            sourceFolderPaths: ['E:\\Other Machine\\Music'],
            tiers: [{ tierId: 'r1', name: 'S', items: ['f9'] }]
          })
        ]
      }),
      MATCHES
    );

    expect(result.notes).toContain(
      "Tierlist 'Empty Board': folder sources dropped (no placements matched)."
    );
    expect(repo.state.playlists).toHaveLength(0);
  });

  test('is a natural no-op when both blocks are absent', () => {
    const repo = createMockTransferRepo(undefined, {
      playlists: [createPlaylist('p1')],
      tierlists: [createTierlist('t1')]
    });

    const result = importCollections(repo, baseExport(), MATCHES);

    expect(result).toEqual({ playlistsImported: 0, tierlistsImported: 0, notes: [] });
    expect(repo.events).toHaveLength(0);
  });
});

describe('optional-block validators', () => {
  test('isValidExportedPlaylist accepts well-formed playlists only', () => {
    const good: ExportedPlaylist = {
      playlistId: 'p1',
      name: 'Mix',
      songs: ['a', 'b'],
      createdDate: '2024-01-01' as unknown as Date
    };
    expect(isValidExportedPlaylist(good)).toBe(true);
    expect(isValidExportedPlaylist({ ...good, name: '  ' })).toBe(false);
    expect(isValidExportedPlaylist({ ...good, songs: [1] as never })).toBe(false);
    expect(isValidExportedPlaylist(undefined as never)).toBe(false);
  });

  test('isValidExportPreferences accepts an absent or clamped intensity', () => {
    expect(isValidExportPreferences({})).toBe(true);
    expect(isValidExportPreferences({ tierShuffleIntensity: 0.5 })).toBe(true);
    expect(isValidExportPreferences({ tierShuffleIntensity: 2 })).toBe(false);
    expect(isValidExportPreferences({ tierShuffleIntensity: Number.NaN })).toBe(false);
  });
});
