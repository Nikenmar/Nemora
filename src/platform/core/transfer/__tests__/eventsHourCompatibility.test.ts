import { jest } from '@jest/globals';

import importStatsData from '../importStats';
import {
  createCounterFile,
  recordListening,
  trackKeyOf,
  type ListeningCounterFile
} from '../../stats/listeningEvents';
import { fingerprintOfSong } from '../../stats/songFingerprint';
import { createMockTransferRepo, createSong } from './testUtils';

jest.mock('@tauri-apps/plugin-dialog', () => ({ open: jest.fn(), save: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginDialog = jest.requireMock('@tauri-apps/plugin-dialog') as {
  open: jest.Mock<() => Promise<string | null>>;
};

/**
 * Hour-of-day arrived after the counter format shipped, so an export can carry
 * a field the reader has never seen. Rejecting it would not fail loudly: the
 * whole events block would be dropped and the import would quietly fall back to
 * the aggregate path, losing per-source provenance while reporting success.
 * That is precisely the class of silent downgrade this subsystem exists to
 * avoid, so it gets a test of its own.
 */
describe('an export carrying hour histograms', () => {
  const LOCAL = createSong('l1', {
    title: 'Midnight Drive',
    artists: [{ artistId: 'a1', name: 'Artist One' }],
    duration: 210,
    path: 'D:\\Local\\midnight_drive.mp3'
  });
  const identity = fingerprintOfSong(LOCAL);

  const exportWithHours = (): ListeningCounterFile => {
    let counters = createCounterFile('install-foreign');
    counters = recordListening(
      counters,
      { ...identity, songId: 'foreign-1' },
      'listen',
      new Date(2025, 0, 1, 23, 15).getTime(),
      'install-foreign'
    );
    return counters;
  };

  test('is imported with its hours intact instead of being silently skipped', async () => {
    const events = exportWithHours();
    const foreignFingerprint = { ...identity, songId: 'foreign-1' };
    const foreign = {
      format: 'nora-cmr-stats-export' as const,
      formatVersion: 1 as const,
      exportId: 'hours-1',
      exportedAt: '2025-01-02T00:00:00.000Z',
      appVersion: 'test',
      songs: [foreignFingerprint],
      listeningData: [
        {
          songId: 'foreign-1',
          listens: [
            { year: 2025, listens: [[new Date(2025, 0, 1).getTime(), 1]] as [number, number][] }
          ]
        }
      ],
      events
    };

    const repo = createMockTransferRepo(
      {},
      { songs: [LOCAL], listeningCounters: createCounterFile('install-local') },
      { 'E:\\Exports\\hours.json': JSON.stringify(foreign) }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\hours.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    expect(report.success).toBe(true);
    const day =
      repo.state.listeningCounters.counters[trackKeyOf(identity)]['install-foreign']['2025-01-01'];
    // The block survived validation, and the hour it carried came with it.
    expect(day.l).toBe(1);
    expect(day.h).toEqual({ '23': 1 });
  });

  test('rejects an events block whose hours are not hours', async () => {
    const events = exportWithHours();
    const key = trackKeyOf(identity);
    (events.counters[key]['install-foreign']['2025-01-01'] as { h?: unknown }).h = { '25': 1 };

    const foreign = {
      format: 'nora-cmr-stats-export' as const,
      formatVersion: 1 as const,
      exportId: 'hours-2',
      exportedAt: '2025-01-02T00:00:00.000Z',
      appVersion: 'test',
      songs: [{ ...identity, songId: 'foreign-1' }],
      listeningData: [
        {
          songId: 'foreign-1',
          listens: [
            { year: 2025, listens: [[new Date(2025, 0, 1).getTime(), 1]] as [number, number][] }
          ]
        }
      ],
      events
    };

    const repo = createMockTransferRepo(
      {},
      { songs: [LOCAL], listeningCounters: createCounterFile('install-local') },
      { 'E:\\Exports\\bad-hours.json': JSON.stringify(foreign) }
    );
    pluginDialog.open.mockResolvedValue('E:\\Exports\\bad-hours.json');

    const report = await importStatsData(repo, 'separateDevices', 'file');

    // A malformed optional block is skipped with a note, never fatal, and the
    // listening data still arrives through the aggregate path.
    expect(report.success).toBe(true);
    expect(repo.state.listeningData.length).toBeGreaterThan(0);
  });
});
