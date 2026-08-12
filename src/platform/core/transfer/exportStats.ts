import { basename } from '../playlists/pathUtils';
import { logger } from '../playlists/logger';
import { generateRandomId } from '../playlists/randomId';
import { showSaveDialog } from '../playlists/dialog';
import type { StatsTransferRepository } from './statsTransferRepository';

/**
 * Port of `src/main/core/statsTransfer/exportStats.ts`. All data arrives
 * through the injected repository; the standalone export file is written with
 * the crash-safe atomic writer. No store is imported directly.
 * Signature: `exportStatsData(repo, options?)`.
 */

const EXPORT_FORMAT = 'nora-cmr-stats-export' as const;

/** App-managed playlist ids — never exported (Favorites = likes, History/Rediscover are derived). */
const EXCLUDED_PLAYLIST_IDS = new Set(['Favorites', 'History', 'Rediscover']);

const exportStatsData = async (
  repo: StatsTransferRepository,
  options?: { tierShuffleIntensity?: number }
): Promise<{ success: boolean; message?: string }> => {
  try {
    const destination = await showSaveDialog({
      title: 'Export Stats',
      defaultPath: `Nemora Stats Export - ${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
      canCreateDirectories: true
    });

    const listeningData = repo.getListeningData();
    const songs = repo.getSongsData();
    const songById = new Map(songs.map((song) => [song.songId, song]));

    // User playlists only — Favorites/History are app-managed and stay local.
    const playlists: ExportedPlaylist[] = repo
      .getPlaylistData()
      .filter((playlist) => !EXCLUDED_PLAYLIST_IDS.has(playlist.playlistId))
      .map((playlist) => ({
        playlistId: playlist.playlistId,
        name: playlist.name,
        songs: playlist.songs,
        createdDate: playlist.createdDate
      }));

    const tierlists = repo.getTierlistData();

    // Fingerprints are how the importing device recognizes songs — songIds are
    // random per install and mean nothing across devices. The union covers
    // listening data, playlist tracks and tierlist placements, so songs that
    // were never listened to still travel with the export.
    const referencedSongIds = new Set<string>();
    for (const entry of listeningData) referencedSongIds.add(entry.songId);
    for (const playlist of playlists) {
      for (const songId of playlist.songs) referencedSongIds.add(songId);
    }
    for (const tierlist of tierlists) {
      for (const tier of tierlist.tiers ?? []) {
        for (const songId of tier.items ?? []) referencedSongIds.add(songId);
      }
    }

    const fingerprints: SongFingerprint[] = [];
    for (const songId of referencedSongIds) {
      const song = songById.get(songId);
      if (!song) continue;
      fingerprints.push({
        songId: song.songId,
        title: song.title,
        artists: song.artists?.map((artist) => artist.name) ?? [],
        duration: song.duration,
        fileName: basename(song.path)
      });
    }

    const elo = repo.getCmrStatsData().elo;

    const tierShuffleIntensity = options?.tierShuffleIntensity;
    const preferences: StatsExportPreferences | undefined =
      typeof tierShuffleIntensity === 'number' && Number.isFinite(tierShuffleIntensity)
        ? { tierShuffleIntensity: Math.min(1, Math.max(0, tierShuffleIntensity)) }
        : undefined;

    const exportFile: StatsExportFile = {
      format: EXPORT_FORMAT,
      formatVersion: 1,
      exportId: generateRandomId(),
      exportedAt: new Date().toISOString(),
      appVersion: repo.appVersion,
      songs: fingerprints,
      listeningData,
      ...(elo.totalDuels > 0 ? { elo } : {}),
      ...(playlists.length > 0 ? { playlists } : {}),
      ...(tierlists.length > 0 ? { tierlists } : {}),
      ...(preferences ? { preferences } : {})
    };

    await repo.writeTextFileAtomic(destination, JSON.stringify(exportFile, null, 2));

    logger.info('Stats data exported successfully.', {
      destination,
      songs: fingerprints.length,
      playlists: playlists.length,
      tierlists: tierlists.length
    });
    return { success: true };
  } catch (error) {
    // User closed the save dialog — not an error, stay silent.
    if ((error as Error).message === 'PROMPT_CLOSED_BEFORE_INPUT') return { success: false };
    logger.error('Failed to export stats data.', { error });
    return { success: false, message: 'Failed to export stats data.' };
  }
};

export default exportStatsData;
