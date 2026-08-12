export interface CatalogState {
  songs: SavableSongData[];
  artists: SavableArtist[];
  albums: SavableAlbum[];
  genres: SavableGenre[];
  playlists: SavablePlaylist[];
  userData: UserData;
  listeningData: SongListeningData[];
  blacklist: Blacklist;
  tierlists: SavableTierlist[];
  cmrStats: CmrStatsData;
}

export interface CatalogRepository {
  getCatalogState(): CatalogState;
  commitCatalogState(state: CatalogState): void;
  removeSongArtwork(songId: string): Promise<void>;
  removeDuelQueueReferences(songIds: readonly string[]): void;
  emitDataUpdate(type: DataUpdateEventTypes, data?: string[], message?: string): void;
  sendMessage(code: MessageCodes, data?: MessageToRendererData): void;
  reportError(error: unknown, context: string): void;
}

export interface CatalogFileDeletionPort {
  permanentlyDelete(path: string): Promise<void>;
  moveToTrash(path: string): Promise<void>;
}
