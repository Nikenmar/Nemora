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

/**
 * Runs the renderer's end-of-session persistence and waits for the stores.
 *
 * The playback position, repeat, shuffle and tier-shuffle state live in the
 * renderer and are written only when `app/beforeQuitEvent` fires, so every way
 * out of the app has to pass through here. In Electron that was guaranteed by a
 * single `before-quit` handler on the application (src/main/main.ts:277); Tauri
 * has no such single choke point, so each exit path calls this explicitly.
 *
 * Never rejects. Quitting must not depend on the writes succeeding: if a store
 * is failing to write, refusing to close leaves the user unable to quit their
 * player, and the data at risk is already at risk either way.
 */
let sessionPersisted: Promise<void> | undefined;

/**
 * How long the quit waits for the stores. A write that has not landed by now is
 * not going to; carrying on costs the last few seconds of session state, while
 * waiting forever costs the user a window that will not close.
 */
const FLUSH_TIMEOUT_MS = 3000;

export const persistSessionBeforeQuit = async (): Promise<void> => {
  // Once per exit, whichever path gets here first. The titlebar button persists
  // and then closes, and closing raises the same close request Alt+F4 does, so
  // without this the session would be written twice on an ordinary quit.
  sessionPersisted ??= (async () => {
    emitLocal('app/beforeQuitEvent');
    try {
      await Promise.race([
        getRuntime().flush(),
        new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))
      ]);
    } catch (error: unknown) {
      console.error('Nemora could not flush stores before quitting.', error);
    }
  })();
  return sessionPersisted;
};

/**
 * Covers the ways out of the app that do not go through our own titlebar:
 * Alt+F4, the taskbar's Close, and anything else that asks Windows to close the
 * window. Without this the renderer never hears about them, because Tauri
 * closes the window itself and the local quit event is only emitted by our own
 * buttons.
 */
export const startQuitPersistence = async (): Promise<void> => {
  await appWindow.onCloseRequested(async (event) => {
    // Hold the close just long enough to write; then close for real. The listener
    // must not run twice, so it is detached before the second close request.
    event.preventDefault();
    await persistSessionBeforeQuit();
    await appWindow.destroy();
  });
};

export const windowControls = {
  minimizeApp: (): void => void appWindow.minimize(),
  toggleMaximizeApp: (): void => void appWindow.toggleMaximize(),
  closeApp: (): void => {
    void persistSessionBeforeQuit().finally(() => appWindow.close());
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
