import { getCurrentWindow } from '@tauri-apps/api/window';

import { getRuntime } from '../runtime';

export const miniPlayer = {
  toggleMiniPlayerAlwaysOnTop: async (isMiniPlayerAlwaysOnTop: boolean): Promise<void> => {
    const runtime = getRuntime();
    await getCurrentWindow().setAlwaysOnTop(isMiniPlayerAlwaysOnTop);
    runtime.saveUserData('preferences.isMiniPlayerAlwaysOnTop', isMiniPlayerAlwaysOnTop);
  }
};
