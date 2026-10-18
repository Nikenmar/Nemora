import { relaunch } from '@tauri-apps/plugin-process';

import { getRuntime } from '../runtime';
import { emitLocal, unsubscribeAll } from './events';

const resetApp = (): void => {
  unsubscribeAll('app/beforeQuitEvent');
  void getRuntime()
    .resetApplicationData()
    .catch((error: unknown) => console.error('Nemora could not reset app data.', error));
};

export const appControls = {
  restartRenderer: (_reason: string): void => {
    const runtime = getRuntime();
    emitLocal('app/beforeQuitEvent');
    void runtime
      .flush()
      .then(() => window.location.reload())
      .catch((error: unknown) =>
        console.error('Nemora could not flush stores before reloading.', error)
      );
  },
  /**
   * A failed flush must not cancel the restart. Restarting is how the user
   * escapes a bad state — a profile just replaced by the Nora import, or a
   * store that has been failing to write — and refusing to relaunch because
   * the writes are broken traps them in exactly the state they are fleeing.
   * The pending data is already lost at that point; the restart is not.
   */
  restartApp: (_reason: string): void => {
    const runtime = getRuntime();
    emitLocal('app/beforeQuitEvent');
    void runtime
      .flush()
      .catch((error: unknown) =>
        console.error('Nemora could not flush stores before relaunching.', error)
      )
      .finally(() => relaunch());
  },
  resetApp,
  stopScreenSleeping: (): void => {
    void getRuntime()
      .stopScreenSleeping()
      .catch((error: unknown) => console.error('Failed to inhibit display sleep.', error));
  },
  allowScreenSleeping: (): void => {
    void getRuntime()
      .allowScreenSleeping()
      .catch((error: unknown) =>
        console.error('Failed to release display sleep inhibition.', error)
      );
  }
};
