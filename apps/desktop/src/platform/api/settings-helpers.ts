import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open } from '@tauri-apps/plugin-shell';

import { getRuntime } from '../runtime';

export const settingsHelpers = {
  getAppLanguage: (_lang: LanguageCodes): void => undefined,
  openInBrowser: (url: string): void => void open(url),
  toggleAutoLaunch: (autoLaunchState: boolean): Promise<void> =>
    getRuntime().toggleAutoLaunch(autoLaunchState),
  openDevtools: (): void => {
    void getRuntime()
      .openDevTools()
      .catch((error: unknown) => console.error('Failed to open developer tools.', error));
  },
  networkStatusChange: (isConnected: boolean): void => {
    console.info(
      isConnected
        ? 'App connected to the internet successfully'
        : 'App disconnected from the internet'
    );
  },
  exportAppData: (localStorageData: string): Promise<void> =>
    getRuntime().exportAppData(localStorageData),
  importAppData: (): Promise<void | LocalStorage> => getRuntime().importAppData(),
  /**
   * Compares a plaintext value against an encrypted one.
   *
   * CONTRACT MISMATCH, PRESERVED BY DESIGN: the preload declares this channel
   * with ZERO arguments, while the legacy main-process handler expected
   * `(data, encryptedData)`. The renderer-facing signature is exactly as the
   * preload exposes it — nothing is invented to "fix" the arity. With no
   * inputs there is nothing to compare, so the result is `false`, which is
   * also what the legacy handler produced when invoked without arguments (its
   * decrypt of `undefined` threw and `compare` returned false).
   */
  compareEncryptedData: async (): Promise<boolean> => false,
  getFolderLocation: async (): Promise<string> => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string') throw new Error('PROMPT_CLOSED_BEFORE_INPUT');
    return selected;
  }
};
