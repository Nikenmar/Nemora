import { basename } from '../playlists/pathUtils';
import { logger } from '../playlists/logger';
import { showOpenDialog } from '../playlists/dialog';
import { joinPath } from '../transfer/joinPath';
import copyDir from './copyDir';
import type { AppDataRepository } from './appDataRepository';

/**
 * Port of `src/main/core/exportAppData.ts`. Writes the whole user profile as
 * plain JSON files (the legacy "Nora exports" format) into a user-selected
 * folder. Standalone writes go through the crash-safe atomic writer; song
 * covers are copied recursively.
 * Signature: `exportAppData(repo, localStorageData)`.
 */

const DEFAULT_EXPORT_DIALOG_OPTIONS = {
  title: 'Select a Destination to Export App Data',
  directory: true
};

/** The song-covers subfolder of the Nora profile. */
export const songCoversFolderPath = (repo: AppDataRepository): Promise<string> =>
  repo.profilePath('song_covers');

const warningMessage = `***** IMPORTANT *****

Please do not try to edit the contents of the 'Nora exports' folder.

This will most likely break the app in your system and you won't be able
to restore your data in Nora again.

These files are in plain-text to show users that there's nothing to hide 
in these config files.

***** ***** ***** *****
`;

type ExportOperation =
  | { filename: string; dataString: string }
  | { filename: string; directory: string };

const exportAppData = async (repo: AppDataRepository, localStorageData: string): Promise<void> => {
  const destinations = await showOpenDialog(DEFAULT_EXPORT_DIALOG_OPTIONS);

  const operations: ExportOperation[] = [
    // SONG DATA
    {
      filename: 'songs.json',
      dataString: JSON.stringify({ songs: repo.getSongsData() })
    },
    // PALETTE DATA
    {
      filename: 'palettes.json',
      dataString: JSON.stringify({ palettes: repo.getPaletteData() })
    },
    // BLACKLIST DATA
    {
      filename: 'blacklist.json',
      dataString: JSON.stringify({ blacklists: repo.getBlacklistData() })
    },
    // ARTIST DATA
    {
      filename: 'artists.json',
      dataString: JSON.stringify({ artists: repo.getArtistsData() })
    },
    // PLAYLIST DATA
    {
      filename: 'playlists.json',
      dataString: JSON.stringify({ playlists: repo.getPlaylistData() })
    },
    // ALBUM DATA
    {
      filename: 'albums.json',
      dataString: JSON.stringify({ albums: repo.getAlbumsData() })
    },
    // GENRE DATA
    {
      filename: 'genres.json',
      dataString: JSON.stringify({ genres: repo.getGenresData() })
    },
    // USER DATA
    {
      filename: 'userData.json',
      dataString: JSON.stringify({ userData: repo.getUserData() })
    },
    // LISTENING DATA
    {
      filename: 'listening_data.json',
      dataString: JSON.stringify({ listeningData: repo.getListeningData() })
    },
    // MERGE-SAFE LISTENING COUNTERS
    {
      filename: 'listening_events.json',
      dataString: JSON.stringify({ listeningEvents: repo.getListeningCounters() })
    },
    // CMR STATS DATA (ELO duels and stats import history)
    {
      filename: 'cmr_stats.json',
      dataString: JSON.stringify({ cmrStats: repo.getCmrStatsData() })
    },
    // LOCAL STORAGE DATA
    {
      filename: 'localStorageData.json',
      dataString: localStorageData
    },
    // WARNING MESSAGE
    {
      filename: 'IMPORTANT - DO NOT EDIT CONTENTS IN THIS DIRECTORY.txt',
      dataString: warningMessage
    },
    // SONG COVERS
    {
      filename: 'song_covers',
      directory: await songCoversFolderPath(repo)
    }
  ];

  try {
    if (Array.isArray(destinations) && destinations.length > 0) {
      const destination =
        basename(destinations[0]) === 'Nora exports'
          ? destinations[0]
          : joinPath(destinations[0], 'Nora exports');
      const { exist } = await repo.makeDir(destination);

      if (exist)
        logger.debug(`'Nora exports' folder already exists. Will re-write contents of the folder.`);

      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        if (!operation) throw new Error('Invalid operation');

        if ('directory' in operation)
          await copyDir(repo, operation.directory, joinPath(destination, 'song_covers'));
        else
          await repo.writeTextFileAtomic(
            joinPath(destination, operation.filename),
            operation.dataString
          );

        logger.debug('Exporting app data. Please wait');
        repo.sendMessage('APPDATA_EXPORT_STARTED', {
          total: operations.length,
          value: i + 1
        });
      }

      logger.debug('Exported app data successfully.');
      return repo.sendMessage('APPDATA_EXPORT_SUCCESS');
    }
    logger.warn(`Failed to export app data because user didn't select a destination.`);
    return repo.sendMessage('DESTINATION_NOT_SELECTED');
  } catch (err) {
    logger.error('Failed to export app data.', { err, destinations });
    repo.sendMessage('APPDATA_EXPORT_FAILED');
    return undefined;
  }
};

export default exportAppData;
