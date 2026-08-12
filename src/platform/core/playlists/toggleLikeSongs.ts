import { logger } from './logger';
import addToFavorites from './addToFavorites';
import removeFromFavorites from './removeFromFavorites';
import type { PlaylistsRepository } from './playlistRepository';

const likeTheSong = (repo: PlaylistsRepository, song: SavableSongData, preventLogging = false) => {
  if (!song.isAFavorite) {
    addToFavorites(repo, song.songId);

    const songArtists = song.artists?.map((artist) => artist.name);
    repo.addAFavoriteToLastFM(song.title, songArtists);

    if (!preventLogging)
      repo.sendMessage('SONG_LIKE', {
        name: song.title.length > 20 ? `${song.title.substring(0, 20).trim()}...` : song.title,
        artworkPath: repo.getSongArtworkPath(song.songId, song.isArtworkAvailable).artworkPath
      });
    song.isAFavorite = true;
    return song;
  }
  return undefined;
};

const dislikeTheSong = (
  repo: PlaylistsRepository,
  song: SavableSongData,
  preventLogging = false
) => {
  if (song.isAFavorite) {
    song.isAFavorite = false;
    removeFromFavorites(repo, song.songId);

    const songArtists = song.artists?.map((artist) => artist.name);
    repo.removeAFavoriteFromLastFM(song.title, songArtists);

    if (!preventLogging)
      repo.sendMessage('SONG_DISLIKE', {
        name: song.title.length > 20 ? `${song.title.substring(0, 20).trim()}...` : song.title,
        artworkPath: repo.getSongArtworkPath(song.songId, song.isArtworkAvailable).artworkPath
      });
    return song;
  }
  return undefined;
};

/**
 * Likes or dislikes songs. With no explicit `isLikeSong` the state toggles.
 * Likes are mirrored into the Favorites playlist and, when configured, to
 * Last.fm. Returns the ids of the songs that actually changed state.
 */
const toggleLikeSongs = async (
  repo: PlaylistsRepository,
  songIds: string[],
  isLikeSong?: boolean
): Promise<ToggleLikeSongReturnValue> => {
  const songs = repo.getSongs();
  const result: ToggleLikeSongReturnValue = {
    likes: [],
    dislikes: []
  };

  logger.info(`Requested to like/dislike song(s).`, { songIds, isLikeSong });

  if (songs.length > 0) {
    const preventNotifications = songIds.length > 5;

    const updatedSongs = songs.map((song) => {
      const isSongIdAvailable = songIds.includes(song.songId);

      if (isSongIdAvailable) {
        if (isLikeSong === undefined) {
          if (song.isAFavorite) {
            const dislikedSongData = dislikeTheSong(repo, song, preventNotifications);
            if (dislikedSongData) {
              result.dislikes.push(song.songId);
              return dislikedSongData;
            }
            return song;
          }
          const likedSongData = likeTheSong(repo, song, preventNotifications);
          if (likedSongData) {
            result.likes.push(song.songId);
            return likedSongData;
          }
          return song;
        }
        if (isLikeSong) {
          const likedSongData = likeTheSong(repo, song, preventNotifications);
          if (likedSongData) {
            result.likes.push(song.songId);
            return likedSongData;
          }
          return song;
        }
        const dislikedSongData = dislikeTheSong(repo, song, preventNotifications);
        if (dislikedSongData) {
          result.dislikes.push(song.songId);
          return dislikedSongData;
        }
        return song;
      }
      return song;
    });

    repo.setSongs(updatedSongs);
    repo.emitDataUpdate('songs/likes', [...result.likes, ...result.dislikes]);
    return result;
  }
  return result;
};

export default toggleLikeSongs;
