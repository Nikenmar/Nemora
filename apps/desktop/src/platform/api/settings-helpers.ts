import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open } from '@tauri-apps/plugin-shell';

import { getBuildEnvVariable } from '../core/net/buildEnv';
import { getRuntime } from '../runtime';
import { ensureLastFmAuthCallbackInstalled } from './lastfm-auth';

/**
 * Opens the Last.fm authorization page in the system browser and installs the
 * callback listener. The browser redirects to `nemora://auth?service=lastfm&
 * token=...` after the user authorizes; the callback lifecycle is described in
 * `lastfm-auth.ts`.
 */
const openLastFmLoginPage = (): void => {
  const apiKey = getBuildEnvVariable('MAIN_VITE_LAST_FM_API_KEY');
  if (!apiKey) {
    console.error(
      'MAIN_VITE_LAST_FM_API_KEY is not configured; cannot open the Last.fm login page.'
    );
    return;
  }
  ensureLastFmAuthCallbackInstalled();
  void open(`http://www.last.fm/api/auth/?api_key=${apiKey}&cb=nemora://auth?service=lastfm`);
};

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
  loginToLastFmInBrowser: (): void => openLastFmLoginPage(),
  getFolderLocation: async (): Promise<string> => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string') throw new Error('PROMPT_CLOSED_BEFORE_INPUT');
    return selected;
  }
};
