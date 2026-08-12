import { readTextFile } from '@tauri-apps/plugin-fs';
import type { OpenDialogOptions } from '@tauri-apps/plugin-dialog';

import { logger } from './logger';
import { basename, extname, isAbsolute } from './pathUtils';
import { showOpenDialog } from './dialog';
import addNewPlaylist from './addNewPlaylist';
import addSongsToPlaylist from './addSongsToPlaylist';
import toggleLikeSongs from './toggleLikeSongs';
import type { PlaylistsRepository } from './playlistRepository';

const DEFAULT_EXPORT_DIALOG_OPTIONS: OpenDialogOptions = {
  title: `Select a Destination where your M3U8 file is`,
  filters: [
    { name: 'M3U8 Files', extensions: ['m3u8'] },
    { name: 'All Files', extensions: ['*'] }
  ]
};

/**
 * Only ABSOLUTE entries are ever considered: the Electron build required
 * `path.isAbsolute` and the port keeps that. Relative M3U8 entries were
 * intentionally never resolved against the working directory, so importing a
 * playlist produced elsewhere cannot silently pick up different files.
 */
const isASongPath = (text: string, supportedMusicExtensions: string[]) => {
  const textLine = text.trim();
  const isTextLineAPath = isAbsolute(textLine);

  if (isTextLineAPath) {
    const textLinePath = textLine;
    const textLinePathExt = extname(textLinePath).split('.').pop() || extname(textLinePath);
    const isPathToASong = supportedMusicExtensions.includes(textLinePathExt);
    return isPathToASong;
  }
  return false;
};

const getSongDataFromSongPath = (repo: PlaylistsRepository, songPath: string) => {
  const songs = repo.getSongs();
  return songs.find((song) => song.path === songPath);
};

const checkPlaylist = (repo: PlaylistsRepository, playlistName: string) => {
  const playlistData = repo.getPlaylists();

  return playlistData.find((playlist) => playlist.name === playlistName);
};

/**
 * Imports an M3U8 file selected through the open dialog. Songs already in the
 * library land in a new or matching playlist; paths outside the library are
 * reported as unavailable. An M3U8 named like an existing playlist adds to
 * that playlist, with Favorites going through the like-toggle instead.
 */
const importPlaylist = async (repo: PlaylistsRepository, supportedMusicExtensions: string[]) => {
  try {
    const destinations = await showOpenDialog(DEFAULT_EXPORT_DIALOG_OPTIONS);

    if (destinations) {
      const [filePath] = destinations;

      if (extname(filePath) === '.m3u8') {
        const fileName = basename(filePath).replace(/\.m3u8$/gim, '');
        const text = await readTextFile(filePath);
        const textArr = text.replaceAll('\r', '').split('\n');

        if (textArr[0] === '#EXTM3U') {
          const unavailableSongPaths: string[] = [];
          const availSongIdsForPlaylist: string[] = [];

          const songPaths = textArr.filter((line) => isASongPath(line, supportedMusicExtensions));

          for (const songPath of songPaths) {
            const songData = getSongDataFromSongPath(repo, songPath);

            if (songData) availSongIdsForPlaylist.push(songData.songId);
            else unavailableSongPaths.push(songPath);
          }

          if (unavailableSongPaths.length > 0) {
            logger.debug(
              `Found ${unavailableSongPaths.length} songs outside the library when importing a playlist.`,
              { unavailableSongPaths }
            );
            repo.sendMessage('PLAYLIST_IMPORT_SUCCESS', { count: availSongIdsForPlaylist.length });
          }

          if (availSongIdsForPlaylist.length > 0) {
            const playlistName = fileName;

            const availablePlaylist = checkPlaylist(repo, playlistName);

            if (availablePlaylist) {
              try {
                if (availablePlaylist.playlistId === 'Favorites') {
                  const newAvailSongIds = availSongIdsForPlaylist.filter(
                    (id) => !availablePlaylist.songs.includes(id)
                  );
                  await toggleLikeSongs(repo, newAvailSongIds, true);
                } else
                  addSongsToPlaylist(repo, availablePlaylist.playlistId, availSongIdsForPlaylist);
                logger.debug(
                  `Imported ${availSongIdsForPlaylist.length} songs to the existing '${availablePlaylist.name}' playlist.`,
                  {
                    playlistName,
                    availSongIdsForPlaylistCount: availSongIdsForPlaylist.length,
                    availablePlaylistName: availablePlaylist.name
                  }
                );
                return repo.sendMessage('PLAYLIST_IMPORT_TO_EXISTING_PLAYLIST', {
                  count: availSongIdsForPlaylist.length,
                  name: availablePlaylist.name
                });
              } catch (error) {
                logger.error('Failed to import songs to an existing playlist.', {
                  playlistName,
                  error
                });
                return repo.sendMessage('PLAYLIST_IMPORT_TO_EXISTING_PLAYLIST_FAILED');
              }
            } else {
              const res = await addNewPlaylist(repo, playlistName, availSongIdsForPlaylist);

              if (res.success) {
                logger.info(`Imported '${fileName}' playlist successfully.`, { fileName });
                return repo.sendMessage('PLAYLIST_IMPORT_SUCCESS', { name: fileName });
              }

              logger.debug('Failed to create a playlist', { res });
              return repo.sendMessage('PLAYLIST_IMPORT_FAILED');
            }
          }
        }
        logger.warn(
          `Failed to import the playlist because user selected a file with invalid file data.`,
          { filePath, firstLine: textArr[0] }
        );
        return repo.sendMessage('PLAYLIST_IMPORT_FAILED_DUE_TO_INVALID_FILE_DATA');
      }
      logger.warn(
        `Failed to import the playlist because user selected a file with a different extension other than 'm3u8'.`,
        { filePath }
      );
      return repo.sendMessage('PLAYLIST_IMPORT_FAILED_DUE_TO_INVALID_FILE_EXTENSION');
    }
    logger.warn(`Failed to export a playlist because user didn't select a file.`);
    return repo.sendMessage('DESTINATION_NOT_SELECTED');
  } catch (error) {
    logger.error(`Failed to import the playlist.`, { error });
    return repo.sendMessage('PLAYLIST_IMPORT_FAILED');
  }
};

export default importPlaylist;
