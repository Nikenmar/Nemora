import { logger } from './logger';
import type { PlaylistsRepository } from './playlistRepository';

const dislikeArtist = (repo: PlaylistsRepository, artist: SavableArtist) => {
  artist.isAFavorite = false;
  repo.sendMessage('ARTIST_DISLIKE', {
    name: artist.name.length > 20 ? `${artist.name.substring(0, 20).trim()}...` : artist.name,
    artworkPath: repo.getArtistArtworkPath(artist.artworkName).artworkPath,
    onlineArtworkPaths: artist.onlineArtworkPaths
  });
  return artist;
};

const likeArtist = (repo: PlaylistsRepository, artist: SavableArtist) => {
  artist.isAFavorite = true;
  repo.sendMessage('ARTIST_LIKE', {
    name: artist.name.length > 20 ? `${artist.name.substring(0, 20).trim()}...` : artist.name,
    artworkPath: repo.getArtistArtworkPath(artist.artworkName).artworkPath,
    onlineArtworkPaths: artist.onlineArtworkPaths
  });
  return artist;
};

/**
 * Likes or dislikes artists. With no explicit `isLikeArtist` the state toggles.
 * Returns the ids of the artists that actually changed state.
 */
const toggleLikeArtists = async (
  repo: PlaylistsRepository,
  artistIds: string[],
  isLikeArtist?: boolean
): Promise<ToggleLikeSongReturnValue> => {
  const artists = repo.getArtists();
  const result: ToggleLikeSongReturnValue = {
    likes: [],
    dislikes: []
  };

  logger.debug(
    `Requested to ${
      isLikeArtist === undefined ? 'toggle like' : isLikeArtist ? 'like' : 'dislike'
    } artists with ids -${artistIds.join(', ')}-`
  );
  if (artists.length > 0) {
    const updatedArtists = artists.map((artist) => {
      if (artistIds.includes(artist.artistId)) {
        if (artist.isAFavorite) {
          if (isLikeArtist !== true) {
            const updatedArtist = dislikeArtist(repo, artist);
            result.dislikes.push(updatedArtist.artistId);
            return updatedArtist;
          }
          logger.debug(
            `Tried to like an artist with a artist id -${artist.artistId}- that has been already been liked.`
          );
          return artist;
        }

        if (isLikeArtist !== false) {
          const updatedArtist = likeArtist(repo, artist);
          result.likes.push(updatedArtist.artistId);
          return updatedArtist;
        }
        logger.debug(
          `Tried to dislike an artist with a artist id -${artist.artistId}- that has been already been disliked.`
        );
        return artist;
      }
      return artist;
    });
    repo.setArtists(updatedArtists);
    repo.emitDataUpdate('artists/likes', [...result.likes, ...result.dislikes]);
    return result;
  }
  return result;
};

export default toggleLikeArtists;
