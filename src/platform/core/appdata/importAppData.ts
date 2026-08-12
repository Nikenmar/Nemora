import { logger } from '../playlists/logger';
import { showOpenDialog } from '../playlists/dialog';
import { joinPath } from '../transfer/joinPath';
import copyDir from './copyDir';
import { songCoversFolderPath } from './exportAppData';
import type { AppDataRepository } from './appDataRepository';

/**
 * Port of `src/main/core/importAppData.ts`. Restores a full "Nora exports"
 * folder into the profile: required files replace the stores, optional files
 * (blacklist, listening data, cmr stats, localStorage) are applied when
 * present, then the app restarts (immediately, or after a five-second grace
 * period when localStorage data must be consumed first).
 * Signature: `importAppData(repo)`.
 */

const requiredItemsForImport = [
  'songs.json',
  'artists.json',
  'playlists.json',
  'genres.json',
  'albums.json',
  'userData.json',
  'song_covers'
];

const optionalItemsForImport = [
  'localStorageData.json',
  'blacklist.json',
  'listening_data.json',
  'cmr_stats.json'
];

const DEFAULT_EXPORT_DIALOG_OPTIONS = {
  title: `Select a Destination where you saved Nora's Exported App Data`,
  directory: true
};

const importRequiredData = async (repo: AppDataRepository, importDir: string) => {
  try {
    // SONG DATA
    const songDataString = await repo.readTextFile(joinPath(importDir, 'songs.json'));
    const songData: SavableSongData[] = JSON.parse(songDataString).songs;

    // PALETTE DATA
    const paletteDataString = await repo.readTextFile(joinPath(importDir, 'palettes.json'));
    const paletteData: PaletteData[] = JSON.parse(paletteDataString).palettes;

    // ARTIST DATA
    const artistDataString = await repo.readTextFile(joinPath(importDir, 'artists.json'));
    const artistData: SavableArtist[] = JSON.parse(artistDataString).artists;

    // PLAYLIST DATA
    const playlistDataString = await repo.readTextFile(joinPath(importDir, 'playlists.json'));
    const playlistData: SavablePlaylist[] = JSON.parse(playlistDataString).playlists;

    // ALBUM DATA
    const albumDataString = await repo.readTextFile(joinPath(importDir, 'albums.json'));
    const albumData: SavableAlbum[] = JSON.parse(albumDataString).albums;

    // GENRE DATA
    const genreDataString = await repo.readTextFile(joinPath(importDir, 'genres.json'));
    const genreData: SavableGenre[] = JSON.parse(genreDataString).genres;

    // USER DATA
    const userDataString = await repo.readTextFile(joinPath(importDir, 'userData.json'));
    const { userData } = JSON.parse(userDataString);

    // SONG COVERS
    await copyDir(repo, joinPath(importDir, 'song_covers'), await songCoversFolderPath(repo));

    // SAVING IMPORTED DATA
    repo.setSongsData(songData);
    repo.setPaletteData(paletteData);
    repo.setArtistsData(artistData);
    repo.setPlaylistData(playlistData);
    repo.setAlbumsData(albumData);
    repo.setGenresData(genreData);
    repo.saveUserData(userData as UserData);
  } catch (error) {
    logger.error('Failed to copy required data from import destination', { error, importDir });
  }
};

const importOptionalData = async (
  repo: AppDataRepository,
  entries: string[],
  importDir: string
): Promise<LocalStorage | undefined> => {
  try {
    // LISTENING DATA
    if (entries.includes('listening_data.json')) {
      const listeningDataString = await repo.readTextFile(
        joinPath(importDir, 'listening_data.json')
      );
      const listeningData: SongListeningData[] = JSON.parse(listeningDataString).listeningData;
      repo.saveListeningData(listeningData);
    }

    // BLACKLIST DATA
    if (entries.includes('blacklist.json')) {
      const blacklistDataString = await repo.readTextFile(joinPath(importDir, 'blacklist.json'));
      const blacklistData: Blacklist = JSON.parse(blacklistDataString).blacklists;
      repo.setBlacklist(blacklistData);
    }

    // CMR STATS DATA
    if (entries.includes('cmr_stats.json')) {
      const cmrStatsDataString = await repo.readTextFile(joinPath(importDir, 'cmr_stats.json'));
      const cmrStatsData: CmrStatsData = JSON.parse(cmrStatsDataString).cmrStats;
      repo.setCmrStatsData(cmrStatsData);
    }

    // LOCAL STORAGE DATA
    if (entries.includes('localStorageData.json')) {
      const localStorageDataString = await repo.readTextFile(
        joinPath(importDir, 'localStorageData.json')
      );
      const localStorageData: LocalStorage = JSON.parse(localStorageDataString);
      return localStorageData;
    }
    return undefined;
  } catch (error) {
    logger.error('Failed to copy optional data from import destination', { error, importDir });
    return undefined;
  }
};

const importAppData = async (repo: AppDataRepository): Promise<LocalStorage | undefined> => {
  try {
    const destinations = await showOpenDialog(DEFAULT_EXPORT_DIALOG_OPTIONS);
    const missingEntries: string[] = [];

    logger.debug('Started to import app data.');
    repo.sendMessage('APPDATA_IMPORT_STARTED');

    if (Array.isArray(destinations) && destinations.length > 0) {
      const importDir = destinations[0];

      const entries = (await repo.readDir(importDir)).map((entry) => entry.name);

      const doesRequiredItemsExist = requiredItemsForImport.every((item) => {
        const isExist = entries.includes(item);
        if (!isExist) missingEntries.push(item);

        return isExist;
      });
      const availableOptionalEntries = optionalItemsForImport.filter((item) =>
        entries.includes(item)
      );

      if (doesRequiredItemsExist) {
        let localStorageData: LocalStorage | undefined;
        if (availableOptionalEntries.length > 0)
          localStorageData = await importOptionalData(repo, availableOptionalEntries, importDir);
        await importRequiredData(repo, importDir);

        logger.info('Successfully imported app data.');
        repo.sendMessage('APPDATA_IMPORT_SUCCESS');

        if (localStorageData) {
          logger.info('Successfully imported app data. Restarting app in 5 seconds');
          repo.sendMessage('APPDATA_IMPORT_SUCCESS_WITH_PENDING_RESTART');
          setTimeout(() => repo.restartApp('Applying imported app data', true), 5000);
          return localStorageData;
        }
        repo.restartApp('Applying imported app data', true);
        return undefined;
      }
      logger.error('Failed to import app data. Missing required files in the selected folder.', {
        missingEntries
      });
      repo.sendMessage('APPDATA_IMPORT_FAILED_DUE_TO_MISSING_FILES');
      return undefined;
    }
    logger.debug('User cancelled the prompt to select the import data.');
    return undefined;
  } catch (error) {
    logger.error('Failed to import app data.', { error });
    repo.sendMessage('APPDATA_IMPORT_FAILED');
    return undefined;
  }
};

export default importAppData;
