/**
 * Data and side-effect seam for the blacklist subsystem.
 *
 * The ported functions never import a store or the Electron main process; the
 * api-bridge constructs a concrete implementation from `CachedStores` and the
 * library's `getSongInfo` (ported separately by the library agent).
 */

export interface BlacklistRepository {
  getBlacklist(): Blacklist;
  setBlacklist(blacklist: Blacklist): void;

  /**
   * Song details used to report a failed whitelist. Must return `SongData`
   * entries whose `isBlacklisted` reflects folder blacklists too, exactly like
   * the Electron `getSongInfo`.
   */
  getSongInfo(songIds: string[]): Promise<SongData[]>;

  /** Mirrors `dataUpdateEvent`; debouncing stays in the adapter. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  /** Mirrors `sendMessageToRenderer`; the adapter routes to the renderer. */
  sendMessage(messageCode: MessageCodes, data?: MessageToRendererData): void;
}
