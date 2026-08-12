import { getPositiveEloScore } from '../stats/duelMatchmaker';
import { tierValue } from '../shuffle/megaShuffle';

/**
 * Rediscover system playlist (fork identity: derived data, regenerated
 * completely on each refresh — manual edits are intentionally disposable).
 *
 * Port of `src/main/core/rediscover.ts`. Library and stats data, the playlist
 * template and the local data-update bus arrive through the injected
 * `RediscoverRepo` — no store is imported directly.
 * Signature: `refreshRediscoverPlaylist(repo, thresholdDays?)`.
 */

export interface RediscoverRepo {
  getSongsData(): SavableSongData[];
  getTierlistData(): SavableTierlist[];
  getCmrStatsData(): CmrStatsData;
  getListeningData(): SongListeningData[];
  getPlaylistData(playlistIds?: string[]): SavablePlaylist[];
  setPlaylistData(playlists: SavablePlaylist[]): void;
  /** The canonical 'Rediscover' template (History pattern: lazy-created system playlist). */
  rediscoverPlaylistTemplate: SavablePlaylist;
  /** Local data-update bus; expected to keep the one-second coalescing behavior. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  isSongBlacklisted(songId: string, songPath: string): boolean;
  logger: {
    info(message: string, data?: object): void;
    error(message: string, data?: object): void;
  };
}

/** Max tracks kept in the Rediscover playlist after each refresh. */
const REDISCOVER_CAP = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export const REDISCOVER_PLAYLIST_ID = 'Rediscover';

/**
 * Rebuilds the Rediscover system playlist: tracks you clearly love (tierlist
 * placement, ELO duels, full listens) but have not heard in `thresholdDays`
 * (or never heard in-app). The playlist is app-managed: every refresh fully
 * regenerates it, so manual edits inside it are intentionally disposable.
 */
const refreshRediscoverPlaylist = (repo: RediscoverRepo, thresholdDays = 30): { count: number } => {
  const threshold = Number.isFinite(thresholdDays) && thresholdDays > 0 ? thresholdDays : 30;
  const cutoff = Date.now() - threshold * DAY_MS;

  try {
    const songs = repo.getSongsData();
    if (!Array.isArray(songs) || songs.length === 0) return { count: 0 };

    // ----- "loved" signal 1: best tier placement across ALL tierlists -----
    const tierScore: Record<string, number> = {};
    for (const tierlist of repo.getTierlistData()) {
      const total = tierlist.tiers.length;
      tierlist.tiers.forEach((tier, index) => {
        const value = tierValue(index, total);
        for (const songId of tier.items) {
          if (!(songId in tierScore) || value > tierScore[songId]) tierScore[songId] = value;
        }
      });
    }

    // ----- "loved" signal 2: ELO (meaningful only after enough duels) -----
    const elo = repo.getCmrStatsData().elo;
    const hasEloData = elo.totalDuels >= 10;
    const eloScore = (songId: string) => {
      const rating = elo.ratings[songId];
      if (!rating || rating.games < 1) return 0;
      return getPositiveEloScore(rating);
    };

    // ----- listening: last-heard timestamps + full-listen nudge -----
    let maxFullListens = 1;
    const lastListenedAt: Record<string, number> = {};
    const fullListensMap: Record<string, number> = {};
    for (const entry of repo.getListeningData()) {
      let last = 0;
      for (const year of entry.listens)
        for (const [dateMs, count] of year.listens) if (count > 0 && dateMs > last) last = dateMs;
      lastListenedAt[entry.songId] = last;
      const full = entry.fullListens ?? 0;
      fullListensMap[entry.songId] = full;
      if (full > maxFullListens) maxFullListens = full;
    }

    // ----- candidates: loved (score > 0) AND forgotten (older than cutoff) -----
    const scored: { songId: string; score: number }[] = [];
    for (const song of songs) {
      if (repo.isSongBlacklisted(song.songId, song.path)) continue;
      const score =
        0.55 * (tierScore[song.songId] ?? 0) +
        0.35 * (hasEloData ? eloScore(song.songId) : 0) +
        0.1 * ((fullListensMap[song.songId] ?? 0) / maxFullListens);
      if (score <= 0) continue;
      if ((lastListenedAt[song.songId] ?? 0) >= cutoff) continue; // heard recently
      scored.push({ songId: song.songId, score });
    }

    scored.sort((a, b) => b.score - a.score || a.songId.localeCompare(b.songId));
    const picked = scored.slice(0, REDISCOVER_CAP).map((entry) => entry.songId);

    // ----- upsert the system playlist (lazy-create, History pattern) -----
    const playlists = repo.getPlaylistData();
    if (!Array.isArray(playlists)) return { count: 0 };
    const existing = playlists.find((playlist) => playlist.playlistId === REDISCOVER_PLAYLIST_ID);
    if (existing) existing.songs = picked;
    else
      playlists.push({
        ...repo.rediscoverPlaylistTemplate,
        createdDate: new Date(),
        songs: picked
      });
    repo.setPlaylistData(playlists);
    repo.emitDataUpdate('playlists/rediscover');

    repo.logger.info('Rediscover playlist refreshed.', {
      thresholdDays: threshold,
      count: picked.length
    });
    return { count: picked.length };
  } catch (error) {
    repo.logger.error('Failed to refresh the Rediscover playlist.', { error });
    return { count: 0 };
  }
};

export default refreshRediscoverPlaylist;
export { refreshRediscoverPlaylist };
