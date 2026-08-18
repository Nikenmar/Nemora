import { appPreferences } from '../../../../package.json';

import convertParsedLyricsToNodeID3Format from './convertParsedLyricsToNodeID3Format';
import { updateCachedLyrics } from './getSongLyrics';
import { removeDefaultAppProtocolFromFilePath, extname } from './pathUtils';
import saveLyricsToLRCFile from './saveLyricsToLrcFile';
import { logger } from './logger';
import type { EmbeddedLyricsWrite, LyricsRepository } from './repository';

const { metadataEditingSupportedExtensions } = appPreferences;

type PendingSongLyrics = EmbeddedLyricsWrite;

const pendingSongLyrics = new Map<string, PendingSongLyrics>();

const saveLyricsToSong = async (repository: LyricsRepository, songPathWithProtocol: string, songLyrics: SongLyrics) => {
  const userData = repository.getUserData();
  const songPath = removeDefaultAppProtocolFromFilePath(songPathWithProtocol);

  if (songLyrics && songLyrics.lyrics.parsedLyrics.length > 0) {
    const pathExt = extname(songPath).replace(/\W/, '');
    const isASupportedFormat = metadataEditingSupportedExtensions.includes(pathExt);

    if (!isASupportedFormat || userData.preferences.saveLyricsInLrcFilesForSupportedSongs)
      saveLyricsToLRCFile(repository, songPath, songLyrics);

    if (isASupportedFormat) {
      const prevTags = await repository.readEmbeddedLyrics(songPath);

      const { isSynced } = songLyrics.lyrics;
      const unsynchronisedLyrics: UnsynchronisedLyrics = !isSynced
        ? {
            language: 'ENG',
            text: songLyrics.lyrics.unparsedLyrics
          }
        : prevTags.unsynchronisedLyrics;

      const synchronisedLyrics = isSynced
        ? convertParsedLyricsToNodeID3Format(songLyrics.lyrics)
        : prevTags.synchronisedLyrics;

      try {
        const updatingTags: PendingSongLyrics = {
          title: songLyrics.title,
          unsynchronisedLyrics,
          synchronisedLyrics: synchronisedLyrics || []
        };
        // Kept to be saved later
        pendingSongLyrics.set(songPath, updatingTags);

        updateCachedLyrics((prevLyrics) => {
          if (prevLyrics)
            return {
              ...prevLyrics,
              ...songLyrics,
              source: 'IN_SONG_LYRICS',
              isOfflineLyricsAvailable: true
            };
          return undefined;
        });
        // Queued, and nothing tells the user it was. The drain
        // (`savePendingSongLyrics`) has no production caller in this build, so
        // the promise the old notification made - "will be saved
        // automatically" - was one the app does not keep: the lyrics stay in
        // the cache for this session and never reach the audio file. The queue
        // and the drain are left intact for whoever wires them up; what is gone
        // is the claim. Lyrics for an unsupported format still go to an LRC
        // file, and that message is still sent, because that one is true.
        return logger.info(`Lyrics for '${songLyrics.title}' were kept for this session.`, {
          songPath
        });
      } catch (error) {
        logger.error(`Failed to update the song file with the new updates. `, { error });
      }
    } else {
      logger.info(`Lyrics for this song with '${pathExt}' extension will be saved in a LRC file.`, {
        songPath
      });
      return repository.sendMessage({
        messageCode: 'LYRICS_SAVED_IN_LRC_FILE',
        data: { ext: pathExt }
      });
    }
  }

  const errorMessage = 'No lyrics found to be saved to the song.';
  logger.error(errorMessage, { songPath });
  throw new Error(errorMessage);
};

export const isLyricsSavePending = (songPath: string) => pendingSongLyrics.has(songPath);

export const savePendingSongLyrics = async (
  repository: LyricsRepository,
  currentSongPath = '',
  forceSave = false
) => {
  if (pendingSongLyrics.size === 0) return logger.info('No pending song lyrics found.');

  logger.info(`Started saving pending song lyrics.`, {
    pendingSongs: pendingSongLyrics.keys
  });

  const entries = pendingSongLyrics.entries();

  for (const [songPath, updatingTags] of entries) {
    const isACurrentlyPlayingSong = songPath === currentSongPath;

    if (forceSave || !isACurrentlyPlayingSong) {
      try {
        await repository.writeEmbeddedLyrics(songPath, updatingTags);

        logger.info(`Successfully saved pending lyrics of '${updatingTags.title}'.`, { songPath });
        repository.sendMessage({
          messageCode: 'PENDING_LYRICS_SAVED',
          data: { title: updatingTags.title }
        });
        repository.emitDataUpdate('songs/lyrics');
        pendingSongLyrics.delete(songPath);
      } catch (error) {
        logger.error(`Failed to save pending song lyrics of a song. `, { error, songPath });
      }
    }
  }
  return undefined;
};

export default saveLyricsToSong;
