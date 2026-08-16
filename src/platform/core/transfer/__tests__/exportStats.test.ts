import { jest } from '@jest/globals';

import exportStatsData from '../exportStats';
import {
  createCounterFile,
  recordListening,
  trackKeyOf,
  type ListeningCounterFile
} from '../../stats/listeningEvents';
import { fingerprintOfSong } from '../../stats/songFingerprint';
import {
  createListeningEntry,
  createMockTransferRepo,
  createPlaylist,
  createSong,
  createTierlist
} from './testUtils';

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: jest.fn(),
  save: jest.fn()
}));

const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  save: jest.Mock<() => Promise<string | null>>;
};

type StatsExportFileWithEvents = StatsExportFile & { events?: ListeningCounterFile };

const parseExport = (contents: string): StatsExportFileWithEvents =>
  JSON.parse(contents) as StatsExportFileWithEvents;

describe('exportStatsData', () => {
  const repoWithData = () =>
    createMockTransferRepo(undefined, {
      songs: [
        createSong('l1', { title: 'Midnight Drive', duration: 210, path: 'D:\\Music\\mid.mp3' }),
        createSong('l2', { title: 'Unheard', duration: 99, path: 'D:\\Music\\unheard.mp3' })
      ],
      listeningData: [
        createListeningEntry('l1', { fullListens: 3, listens: [{ year: 2025, listens: [[1, 2]] }] })
      ],
      playlists: [
        createPlaylist('p1', { name: 'Road Trip', songs: ['l1', 'l2'] }),
        createPlaylist('Favorites', { songs: ['l1'] }),
        createPlaylist('History', { songs: ['l1'] }),
        createPlaylist('Rediscover', { songs: ['l2'] })
      ],
      tierlists: [
        createTierlist('t1', {
          tiers: [{ tierId: 'row1', name: 'S', items: ['l1'] }]
        })
      ],
      cmrStats: {
        elo: {
          ratings: { l1: { rating: 1300, games: 12, wins: 8, losses: 4 } },
          history: [{ at: 1, songAId: 'l1', songBId: 'l2', winner: 'A', deltaA: 5, deltaB: -5 }],
          totalDuels: 12
        },
        importedStatsExportIds: []
      }
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('exports fingerprints, user playlists, tierlists and elo', async () => {
    const repo = repoWithData();
    pluginDialog.save.mockResolvedValue('E:\\Exports\\stats.json');

    const result = await exportStatsData(repo);

    expect(result).toEqual({ success: true });
    expect(pluginDialog.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Export Stats',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        canCreateDirectories: true
      })
    );
    expect(repo.writes).toHaveLength(1);
    expect(repo.writes[0]?.path).toBe('E:\\Exports\\stats.json');

    const exported = parseExport(repo.writes[0]!.contents);
    expect(exported.format).toBe('nora-cmr-stats-export');
    expect(exported.formatVersion).toBe(1);
    expect(exported.exportId).toMatch(/^[a-zA-Z]{10}$/);
    expect(exported.appVersion).toBe('3.4.5-CMR-Fork');
    expect(typeof exported.exportedAt).toBe('string');

    // Both songs travel: l1 via listening data, l2 only via the playlist.
    const songIds = exported.songs.map((song) => song.songId).sort();
    expect(songIds).toEqual(['l1', 'l2']);
    expect(exported.songs.find((song) => song.songId === 'l1')).toMatchObject({
      title: 'Midnight Drive',
      artists: [],
      duration: 210,
      fileName: 'mid.mp3'
    });

    // System playlists never leave the device.
    expect(exported.playlists).toEqual([
      { playlistId: 'p1', name: 'Road Trip', songs: ['l1', 'l2'], createdDate: expect.any(String) }
    ]);
    expect(exported.tierlists).toHaveLength(1);
    expect(exported.elo?.totalDuels).toBe(12);
    expect(exported.listeningData).toHaveLength(1);
  });

  test('carries only referenced counters while an old reader sees unchanged listeningData', async () => {
    const repo = repoWithData();
    const originalListeningData = structuredClone(repo.state.listeningData);
    const referenced = fingerprintOfSong(repo.state.songs[0]);
    const unrelated = fingerprintOfSong(createSong('not-exported'));
    let counters = createCounterFile('install-a');
    counters = recordListening(counters, referenced, 'listen', new Date(2025, 0, 2).getTime(), 'a');
    counters = recordListening(counters, unrelated, 'listen', new Date(2025, 0, 2).getTime(), 'a');
    repo.state.listeningCounters = counters;
    pluginDialog.save.mockResolvedValue('E:\\Exports\\stats.json');

    await exportStatsData(repo);

    const exported = parseExport(repo.writes[0]!.contents);
    expect(exported.formatVersion).toBe(1);
    expect(Object.keys(exported.events?.tracks ?? {})).toEqual([trackKeyOf(referenced)]);
    expect(Object.keys(exported.events?.counters ?? {})).toEqual([trackKeyOf(referenced)]);

    // This is the complete surface an older formatVersion-1 reader consumes.
    const oldStyleReader = JSON.parse(repo.writes[0]!.contents) as {
      listeningData: SongListeningData[];
    };
    expect(JSON.stringify(oldStyleReader.listeningData)).toBe(
      JSON.stringify(originalListeningData)
    );
  });

  test('omits elo and optional blocks when absent', async () => {
    const repo = createMockTransferRepo(undefined, {
      songs: [createSong('l1')],
      listeningData: [],
      playlists: [],
      tierlists: []
    });
    pluginDialog.save.mockResolvedValue('E:\\Exports\\stats.json');

    await exportStatsData(repo);

    const exported = parseExport(repo.writes[0]!.contents);
    expect(exported.elo).toBeUndefined();
    expect(exported.playlists).toBeUndefined();
    expect(exported.tierlists).toBeUndefined();
    expect(exported.preferences).toBeUndefined();
  });

  test('clamps the tier shuffle intensity into 0..1', async () => {
    const repo = repoWithData();
    pluginDialog.save.mockResolvedValue('E:\\Exports\\stats.json');

    await exportStatsData(repo, { tierShuffleIntensity: 1.7 });

    const exported = parseExport(repo.writes[0]!.contents);
    expect(exported.preferences).toEqual({ tierShuffleIntensity: 1 });
  });

  test('stays silent when the save dialog is cancelled', async () => {
    const repo = repoWithData();
    pluginDialog.save.mockResolvedValue(null);

    const result = await exportStatsData(repo);

    expect(result).toEqual({ success: false });
    expect(repo.writes).toHaveLength(0);
  });

  test('reports a failure message when the atomic write throws', async () => {
    const repo = repoWithData();
    pluginDialog.save.mockResolvedValue('E:\\Exports\\stats.json');
    repo.writeTextFileAtomic = jest.fn(async () => {
      throw new Error('disk full');
    });

    const result = await exportStatsData(repo);

    expect(result).toEqual({ success: false, message: 'Failed to export stats data.' });
  });
});
