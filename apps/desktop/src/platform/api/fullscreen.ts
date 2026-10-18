import { getCurrentWindow } from '@tauri-apps/api/window';

import { emitLocal, subscribeNoPayload } from './events';

const appWindow = getCurrentWindow();
let bridgeInstalled = false;
let previousFullscreenState: boolean | undefined;

const ensureFullscreenBridge = (): void => {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  void appWindow.isFullscreen().then((state) => {
    previousFullscreenState = state;
  });
  void appWindow.onResized(async () => {
    const isFullscreen = await appWindow.isFullscreen();
    if (previousFullscreenState === undefined) {
      previousFullscreenState = isFullscreen;
      return;
    }
    if (isFullscreen === previousFullscreenState) return;
    previousFullscreenState = isFullscreen;
    emitLocal(isFullscreen ? 'app/enteredFullscreen' : 'app/leftFullscreen');
  });
};

export const fullscreen = {
  onEnterFullscreen: (callback: (event: unknown) => void): void => {
    ensureFullscreenBridge();
    subscribeNoPayload('app/enteredFullscreen', callback);
  },
  onLeaveFullscreen: (callback: (event: unknown) => void): void => {
    ensureFullscreenBridge();
    subscribeNoPayload('app/leftFullscreen', callback);
  }
};
