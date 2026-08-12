import { writeTextFile } from '@tauri-apps/plugin-fs';

import { logger } from './logger';
import { basename } from './pathUtils';
import { showSaveDialog } from './dialog';
import type { PlaylistsRepository } from './playlistRepository';

const generateSaveDialogOptions = (playlistName: string) => ({
  title: `Select the destination to save '${playlistName}' playlist`,
  defaultPath: playlistName,
  filters: [
    {
      extensions: ['m3u8'],
      name: 'M3U8 Files'
    }
  ],
  canCreateDirectories: true
});

const createM3u8FileForPlaylist = async (repo: PlaylistsRepository, playlist: SavablePlaylist) => {
  const songs = repo.getSongs();
  const { name, songs: playlistSongIds, playlistId } = playlist;
  const saveOptions = generateSaveDialogOptions(name);

  try {
    const destination = await showSaveDialog(saveOptions);
    if (destination) {
      const m3u8DataArr = ['#EXTM3U', `#${basename(destination)}`, ''];

      for (const song of songs) {
        if (playlistSongIds.includes(song.songId)) m3u8DataArr.push(song.path);
      }

      const m3u8FileData = m3u8DataArr.join('\n');

      await writeTextFile(destination, m3u8FileData);

      logger.debug(`Exported playlist successfully.`, { playlistId, name });
      return repo.sendMessage('PLAYLIST_EXPORT_SUCCESS', { name });
    }
    logger.warn(`Failed to export playlist because user didn't select a destination.`, {
      name,
      playlistId
    });
    return repo.sendMessage('DESTINATION_NOT_SELECTED');
  } catch (error) {
    logger.debug(`Failed to export playlist.`, { error, name, playlistId });
    return repo.sendMessage('PLAYLIST_EXPORT_FAILED', { name });
  }
};

/**
 * Exports a playlist to an M3U8 file via the save dialog. Song paths inside
 * the file point at the library's absolute song paths, like the Electron build.
 */
const exportPlaylist = (repo: PlaylistsRepository, playlistId: string) => {
  const playlists = repo.getPlaylists();

  for (const playlist of playlists) {
    if (playlist.playlistId === playlistId) return createM3u8FileForPlaylist(repo, playlist);
  }

  return logger.warn("Failed to export playlist because requested playlist didn't exist.", {
    playlistId
  });
};

export default exportPlaylist;
