import { getRuntime } from '../runtime';
import type { NoraImportReport } from '../core/import/importNora';
import type { NoraSourceInventory } from '../core/import/detectNoraSource';

/**
 * Migration from the other player. Nemora keeps its own profile in
 * `%APPDATA%\Nemora`; `%APPDATA%\Nora` — written by this fork or by upstream
 * Nora 3.1.0 — is a read-only source that the user can pull in once.
 *
 * This channel has no Electron ancestor: Electron migrated its own profile in
 * place, whereas Nemora is a separate application importing a foreign one.
 */

export const noraImport = {
  /**
   * Describes what is sitting in `%APPDATA%\Nora`, or `null` when there is
   * nothing importable there. Absence is the normal case for a user who never
   * ran Nora, so it is not an error — the UI simply hides the action.
   *
   * A source that exists but is unreadable also lands here as `null` after
   * being logged: the button is about offering an import, and a source that
   * cannot be inspected has nothing to offer. The real diagnosis belongs to
   * `importProfile`, which reports why it refused.
   */
  detectSource: async (): Promise<NoraSourceInventory | null> => {
    try {
      return await getRuntime().detectNoraImportSource();
    } catch (error) {
      console.info('No importable Nora profile was found.', error);
      return null;
    }
  },

  /**
   * Replaces this profile with Nora's, after backing the current one up.
   *
   * Destructive by design — it is a migration, not a merge — so the caller
   * must confirm with the user first. On success the app MUST be relaunched:
   * every store on disk has been replaced and the running state no longer
   * describes it. See `NoraRuntime.importNoraProfileData` for the ordering
   * that makes this safe while the app is live.
   */
  importProfile: (): Promise<NoraImportReport> => getRuntime().importNoraProfileData()
};
