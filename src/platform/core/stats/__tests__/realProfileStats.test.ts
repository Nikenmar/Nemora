/**
 * Runs the real statistics computation against a copy of an actual profile.
 *
 * Unit tests with three synthetic songs cannot tell you that a page is wrong;
 * this one caught a total that was seven times too large while the per-song
 * numbers beside it were right, which is exactly the inconsistency that made
 * the page look broken.
 *
 * Skipped unless NORA_STATS_FIXTURE points at a profile directory, so it never
 * fails on a machine that has no such copy.
 */
import nodeFs from 'node:fs';
import nodePath from 'node:path';

import getStatsData, { type StatsDataRepo } from '../getStatsData';
import { dedupeListeningRows } from '../mergeListeningData';

const fixture = process.env.NORA_STATS_FIXTURE;
const maybe = fixture ? describe : describe.skip;

const read = (name: string) =>
  JSON.parse(nodeFs.readFileSync(nodePath.join(fixture!, name), 'utf8'));

const build = (listeningData: unknown[]): StatsDataRepo =>
    ({
      getSongsData: () => read('songs.json').songs,
      getListeningData: () => listeningData,
      getPlaylistData: (ids?: string[]) => {
        const all = read('playlists.json').playlists;
        return ids ? all.filter((p: { playlistId: string }) => ids.includes(p.playlistId)) : all;
      },
      getGenresData: () => read('genres.json').genres,
      getCmrStatsData: () => read('cmr_stats.json').cmrStats,
      getSongArtworkPath: () => ({
        isDefaultArtwork: true,
        artworkPath: '',
        optimizedArtworkPath: ''
      }),
      isSongBlacklisted: () => false,
      logger: { debug: () => undefined }
    }) as unknown as StatsDataRepo;

maybe('statistics over a real profile', () => {

  test('the total agrees with the sum of the per-song figures', () => {
    const rows = dedupeListeningRows(read('listening_data.json').listeningData);
    const stats = getStatsData(build(rows), 'allTime');

    const perSongSum = (rows as unknown as SongListeningData[]).reduce(
      (sum, row) =>
        sum +
        (row.listens ?? []).reduce(
          (yearSum, year) => yearSum + year.listens.reduce((a, [, count]) => a + count, 0),
          0
        ),
      0
    );

    // Before the read-side dedup these disagreed by a factor of 7.2: the total
    // accumulated every duplicate row while the per-song map kept only the last.
    expect(stats.totals.totalListens).toBe(perSongSum);
  });

  test('the top song is not larger than the total', () => {
    const rows = dedupeListeningRows(read('listening_data.json').listeningData);
    const stats = getStatsData(build(rows), 'allTime');

    expect(stats.topSongs.length).toBeGreaterThan(0);
    expect(stats.topSongs[0].listensInRange).toBeLessThanOrEqual(stats.totals.totalListens);
    // A top track cannot account for a rounding error's worth of a real library.
    expect(stats.topSongs[0].listensInRange).toBeGreaterThan(0);
  });

  test('deduplication is what keeps the total honest', () => {
    const raw = read('listening_data.json').listeningData;
    const deduped = dedupeListeningRows(raw);
    const rawStats = getStatsData(build(raw), 'allTime');
    const dedupedStats = getStatsData(build(deduped), 'allTime');

    if (raw.length !== deduped.length) {
      expect(rawStats.totals.totalListens).toBeGreaterThan(dedupedStats.totals.totalListens);
    }
    expect(dedupedStats.totals.totalListens).toBeGreaterThan(0);
  });
});

maybe('headline figures', () => {
  test('print what the Stats page will show', () => {
    const rows = dedupeListeningRows(read('listening_data.json').listeningData);
    const s = getStatsData(build(rows), 'allTime');
    console.log('listens        :', s.totals.totalListens);
    console.log('full listens   :', s.totals.fullListens);
    console.log('skips          :', s.totals.skips);
    console.log('songs played   :', s.totals.distinctSongsPlayed);
    console.log('hours listened :', Math.round(s.totals.approxListeningTimeSec / 3600));
    console.log('top song       :', s.topSongs[0].listensInRange, s.topSongs[0].title.slice(0, 40));
    expect(s.totals.totalListens).toBeGreaterThan(0);
  });
});
