import { getCurrentWindow } from '@tauri-apps/api/window';

import { getRuntime } from '../runtime';
import {
  createGeometryRepository,
  tauriEventPort,
  tauriInvokePort,
  tauriWindowPort,
  WindowGeometryController,
  type ShellUserDataPort
} from '../shell';
import { emitLocal } from './events';

const appWindow = getCurrentWindow();

/**
 * Window geometry is owned by `WindowGeometryController`.
 *
 * This module used to apply sizes and positions by hand, and the half it never
 * implemented was persistence: nothing listened for move or resize, so
 * `windowDiamensions.*` was never written by any production code path and a
 * window the user had resized reopened at the default size every time. The
 * controller was written for exactly this - debounced persist on move/resize,
 * per-mode size limits, and a clamp against the live monitor list so a window
 * saved on a monitor that is now gone cannot open off-screen - and nothing ever
 * constructed it.
 *
 * One consequence of the handover is worth knowing: the controller stores
 * PHYSICAL pixels (`outerPosition`/`outerSize`), while the old centring
 * fallback here wrote LOGICAL ones. On a display above 100% scaling, a position
 * saved by an older build is read once as if it were physical. The clamp keeps
 * that on-screen, and the first save afterwards rewrites it in physical pixels,
 * so it self-corrects after a single launch.
 */
const userDataPort: ShellUserDataPort = {
  getUserData: () => getRuntime().getUserData(),
  saveUserData: (path, value) => getRuntime().saveUserData(path, value)
};

let geometry: WindowGeometryController | undefined;

const geometryController = (): WindowGeometryController => {
  geometry ??= new WindowGeometryController(
    tauriWindowPort,
    tauriInvokePort,
    tauriEventPort,
    createGeometryRepository(userDataPort)
  );
  return geometry;
};

/**
 * Installs the move/resize listeners and restores the saved main-window rect.
 *
 * Called from the renderer bootstrap after the runtime is hydrated, because the
 * repository reads `userData` and there is nothing to restore before that.
 */
export const startWindowGeometry = async (): Promise<void> => {
  const controller = geometryController();
  await controller.start();
  await controller.restore('normal');
};

const changePlayerType = (type: PlayerTypes): Promise<void> =>
  geometryController().changeMode(type);

export const windowControls = {
  minimizeApp: (): void => void appWindow.minimize(),
  toggleMaximizeApp: (): void => void appWindow.toggleMaximize(),
  closeApp: (): void => {
    const runtime = getRuntime();
    emitLocal('app/beforeQuitEvent');
    // Closing must not depend on the writes succeeding: if a store is failing
    // to write, refusing to close leaves the user unable to quit their player.
    void runtime
      .flush()
      .catch((error: unknown) =>
        console.error('Nemora could not flush stores before closing.', error)
      )
      .finally(() => appWindow.close());
  },
  hideApp: (): void => void appWindow.hide(),
  showApp: (): void => void appWindow.show(),
  changePlayerType,
  onWindowFocus: (callback: (event: unknown) => void): void => {
    void appWindow.onFocusChanged(({ payload }) => {
      if (payload) callback(undefined);
    });
  },
  onWindowBlur: (callback: (event: unknown) => void): void => {
    void appWindow.onFocusChanged(({ payload }) => {
      if (!payload) callback(undefined);
    });
  }
};
