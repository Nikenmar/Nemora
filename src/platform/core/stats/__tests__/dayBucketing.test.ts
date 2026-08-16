/**
 * Guards the day bucketing after it stopped building a Date per listening row.
 *
 * The calendar and the activity chart decide which column a listen belongs to,
 * and both now derive that from a cached per-day answer instead of
 * `new Date(y, m, d)`. This checks the cheap spelling lands on the same day as
 * the obvious one, including across a daylight-saving boundary, which is the
 * only place the two can disagree.
 */
import { describe, expect, test } from '@jest/globals';

import { getStatsData, type StatsDataRepo } from '../getStatsData';
import { createCounterFile } from '../listeningEvents';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The spelling the code used before the cache, kept here as the oracle. */
const midnightByDateConstructor = (dateMs: number): number => {
  const date = new Date(dateMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const repoWith = (rows: [number, number][]): StatsDataRepo => ({
  getSongsData: () => [
    {
      songId: 'song-1',
      title: 'Only Song',
      path: 'E:\\Music\\only.mp3',
      duration: 200,
      isAFavorite: false,
      isArtworkAvailable: false,
      addedDate: 1,
      genres: []
    } as unknown as SavableSongData
  ],
  getListeningData: () => [
    {
      songId: 'song-1',
      listens: [{ year: new Date(rows[0][0]).getFullYear(), listens: rows }]
    }
  ],
  getListeningCounters: () => createCounterFile('test-install'),
  getPlaylistData: () => [],
  getGenresData: () => [],
  getCmrStatsData: () => ({ elo: { ratings: {}, history: [] } }) as unknown as CmrStatsData,
  getSongArtworkPath: () => ({
    isDefaultArtwork: true,
    artworkPath: 'default.webp',
    optimizedArtworkPath: 'default.webp'
  }),
  isSongBlacklisted: () => false,
  logger: { debug: () => undefined }
});

describe('day bucketing', () => {
  test('a listen lands on its own calendar day, and yesterday on yesterday', () => {
    const now = Date.now();
    const today = midnightByDateConstructor(now) + 11 * 60 * 60 * 1000;
    const yesterday = today - DAY_MS;

    const stats = getStatsData(
      repoWith([
        [today, 3],
        [yesterday, 5]
      ]),
      'last30Days'
    );

    const days = stats.calendar.days;
    expect(days.at(-1)?.listens).toBe(3);
    expect(days.at(-2)?.listens).toBe(5);
    // The 30-day activity chart reads the same rows through the same helper.
    expect(stats.activity.at(-1)?.listens).toBe(3);
    expect(stats.activity.at(-2)?.listens).toBe(5);
    expect(stats.calendar.currentStreak).toBe(2);
  });

  test('every hour of a day, and both daylight-saving weekends, bucket as before', () => {
    // Northern-hemisphere transitions plus a plain winter day. The oracle is
    // the Date-constructor spelling; the cheap one may differ by up to an hour
    // on a transition day, which must not move the listen to another column.
    const samples = [
      Date.UTC(2026, 2, 29, 0, 30),
      Date.UTC(2026, 2, 29, 12, 0),
      Date.UTC(2026, 9, 25, 1, 30),
      Date.UTC(2026, 9, 25, 23, 45),
      Date.UTC(2026, 0, 15, 6, 0)
    ];

    for (const sample of samples) {
      for (let hour = 0; hour < 24; hour += 1) {
        const at = sample + hour * 60 * 60 * 1000;
        const oracle = midnightByDateConstructor(at);
        // What the code computes, reproduced exactly: the offset at the
        // timestamp, floored to a whole local day.
        const offsetMs = new Date(at).getTimezoneOffset() * 60_000;
        const cheap = Math.floor((at - offsetMs) / DAY_MS) * DAY_MS + offsetMs;

        expect(Math.abs(Math.round((oracle - cheap) / DAY_MS))).toBe(0);
      }
    }
  });
});
