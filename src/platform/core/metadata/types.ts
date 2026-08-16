export interface MetadataCatalog {
  songs: SavableSongData[];
  artists: SavableArtist[];
  albums: SavableAlbum[];
  genres: SavableGenre[];
}

export interface MetadataPicture {
  bytes: Uint8Array;
  mimeType: string;
}

export interface MetadataFileData {
  title?: string;
  artists: string[];
  albumArtists: string[];
  album?: string;
  genres: string[];
  year?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  duration: number;
  bitrate?: number | null;
  sampleRate?: number | null;
  numberOfChannels?: number | null;
  createdDate?: number | null;
  modifiedDate?: number | null;
  picture?: MetadataPicture;
}

export type MetadataArtworkUpdate =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; path: string };

export interface MetadataTagPatch {
  title?: string;
  artists?: string[];
  albumArtists?: string[];
  album?: string;
  genres?: string[];
  composer?: string;
  trackNumber?: number;
  year?: number;
  synchronizedLyrics?: string;
  unsynchronizedLyrics?: string;
  artwork?: MetadataArtworkUpdate;
}

export interface MetadataFilePort {
  read(path: string): Promise<MetadataFileData>;
  write(path: string, patch: MetadataTagPatch): Promise<void>;
  /**
   * Repairs embedded pictures whose MIME type is missing or blank and reports
   * how many were repaired, so a caller can tell "nothing was wrong here" from
   * "the file was broken and is now fixed" - the difference between retrying
   * playback and giving up on it.
   */
  healBlankPictureMime(path: string): Promise<number>;
}

export type MetadataArtworkSource =
  | { kind: 'path'; path: string }
  | { kind: 'embedded'; picture: MetadataPicture };

export type PathBackedMetadataPlayerData = Omit<AudioPlayerData, 'artwork'> & {
  artwork?: string;
};

export interface MetadataUpdateResult {
  success: boolean;
  reason?: string;
  updatedData?: PathBackedMetadataPlayerData;
}

export interface MetadataRepository {
  getCatalog(): MetadataCatalog;
  commitCatalog(catalog: MetadataCatalog): void;
  createId(): string;
  file: MetadataFilePort;
  getSongArtwork(song: SavableSongData): ArtworkPaths;
  replaceSongArtwork(songId: string, source?: MetadataArtworkSource): Promise<ArtworkPaths>;
  createTemporaryArtwork(path: string): Promise<string | undefined>;
  getUnknownSong(path: string): AudioPlayerData | undefined;
  updateUnknownSong(songId: string, value: AudioPlayerData): void;
  createPlayerData(song: SavableSongData, cacheToken: string): PathBackedMetadataPlayerData;
  emitDataUpdate(type: DataUpdateEventTypes, ids?: string[]): void;
  sendMessage(messageCode: MessageCodes, data?: MessageToRendererData): void;
}

export interface CatalogArtistInput {
  artistId?: string;
  name: string;
}

export interface CatalogAlbumInput {
  albumId?: string;
  title: string;
}

export interface CatalogGenreInput {
  genreId?: string;
  name: string;
}

export interface CatalogSongPatch {
  title?: string;
  artists?: CatalogArtistInput[];
  albumArtists?: CatalogArtistInput[];
  album?: CatalogAlbumInput;
  genres?: CatalogGenreInput[];
  year?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  duration?: number;
  bitrate?: number | null;
  sampleRate?: number | null;
  numberOfChannels?: number | null;
  createdDate?: number | null;
  modifiedDate?: number | null;
  artworkAvailable?: boolean;
  artworkName?: string;
}

export interface CatalogPlan {
  catalog: MetadataCatalog;
  song: SavableSongData;
}

export interface CatalogBatchPlan {
  catalog: MetadataCatalog;
  songIds: string[];
  tagPatches: Map<string, MetadataTagPatch>;
}
