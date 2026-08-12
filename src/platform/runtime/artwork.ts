export interface RuntimeArtworkPaths {
  song(songId: string, isAvailable?: boolean): ArtworkPaths;
  artist(artworkName?: string): ArtworkPaths;
  album(artworkName?: string): ArtworkPaths;
  genre(artworkName?: string): ArtworkPaths;
  playlist(playlistId: string, isAvailable: boolean): ArtworkPaths;
  songFile(songPath: string): string;
  localPath?(artworkUrl: string): string | undefined;
}
