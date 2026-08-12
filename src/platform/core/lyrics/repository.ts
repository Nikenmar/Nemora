import type { Tags } from 'node-id3';

/**
 * Data and side-effect seam for the lyrics subsystem.
 *
 * The ported functions never import a store, the Electron main process, or
 * node-id3; the api-bridge constructs a concrete implementation from the store
 * layer, the tags subsystem (embedded lyric read/write) and the safeStorage
 * port (token decryption). Every method mirrors one call the Electron code made
 * against `filesystem.ts`, `main.ts`, `node-id3`, `safeStorage.ts` or the
 * `songlyrics` package.
 */

/** The ID3 lyric fields the tags subsystem exposes. */
export interface EmbeddedLyricsTags {
  synchronisedLyrics?: NonNullable<Tags['synchronisedLyrics']>;
  unsynchronisedLyrics?: NonNullable<Tags['unsynchronisedLyrics']>;
}

/** The tag payload written back into a song file by the tags subsystem. */
export interface EmbeddedLyricsWrite {
  title: string;
  unsynchronisedLyrics: UnsynchronisedLyrics;
  synchronisedLyrics: SynchronisedLyrics;
}

/** Shape of a result from the external `songlyrics` search fallback. */
export interface UnsyncedLyricsHit {
  lyrics: string;
  source: { name: string; url: string };
}

export interface LyricsRepository {
  /**
   * Mirrors `getUserData`; used for LRC paths, preferences and the custom
   * token. The store always returns the full UserData shape.
   */
  getUserData(): UserData;

  /**
   * Reads the embedded lyrics of a song file. Mirrors `NodeID3.read` /
   * `NodeID3.Promise.read`; implemented by the tags subsystem.
   */
  readEmbeddedLyrics(songPath: string): Promise<EmbeddedLyricsTags>;

  /**
   * Embeds lyrics tags into a song file. Mirrors `NodeID3.update`; implemented
   * by the tags subsystem.
   */
  writeEmbeddedLyrics(songPath: string, tags: EmbeddedLyricsWrite): Promise<void>;

  /**
   * Mirrors `decrypt` from `safeStorage.ts` (scoped to token values). Async in
   * the webview: Web Crypto has no synchronous decrypt.
   */
  decrypt(encrypted: string): Promise<string>;

  /**
   * Searches an external lyrics site for unsynced lyrics. Mirrors the
   * `songlyrics` package call, which is not web-safe and stays behind the
   * bridge.
   */
  searchUnsyncedLyrics(query: string): Promise<UnsyncedLyricsHit | undefined>;

  /** Mirrors `sendMessageToRenderer`; the adapter routes to the renderer. */
  sendMessage(message: { messageCode: MessageCodes; data?: MessageToRendererData }): void;

  /** Mirrors `dataUpdateEvent`; debouncing stays in the adapter. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[]): void;
}
