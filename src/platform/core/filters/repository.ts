/**
 * Data access contract for the blacklist-aware filter and sort logic.
 *
 * `isSongBlacklisted` is injected rather than re-implemented here because the
 * original relies on Node path normalization semantics (folders may be
 * blacklisted by prefix); the api-bridge supplies the implementation against
 * the store layer so the platform core stays pure.
 */
export interface BlacklistRepository {
  isSongBlacklisted(songId: string, songPath: string): boolean;
  getFolderBlacklist(): string[];
}
