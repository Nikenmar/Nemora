import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { PowerController, TauriPowerStatePort } from '../shell/power';
import { emitLocal, scalarPayload, subscribe, unsubscribe } from './events';

type BatteryCallback = (event: unknown, isOnBatteryPower: boolean) => void;

/**
 * Battery reporting, connected to the Rust side that was already producing it.
 *
 * `system.rs` polls `GetSystemPowerStatus` and emits `nemora://power-source-changed`
 * on every change, and `PowerController` was written to turn that into the
 * renderer's `app/isOnBatteryPower` event. Nothing constructed the controller,
 * so the event was never emitted once: `isOnBatteryPower` stayed at its initial
 * `false` for the life of the process and the "remove animations on battery
 * power" preference could not fire at all.
 *
 * The controller is started on first subscription rather than at boot because
 * the subscriber is a React effect that runs after this module is loaded, and
 * an initial value published before anyone listens is a value nobody receives.
 * For the same reason a late subscriber is handed the last known state
 * immediately.
 */
const ports = {
  commands: { invoke: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args) },
  events: {
    listen: async <T>(event: string, handler: (payload: T) => void) =>
      listen<T>(event, ({ payload }) => handler(payload))
  }
};

let controller: PowerController | undefined;
let lastKnownState: boolean | undefined;

const ensureControllerStarted = (): void => {
  if (controller) return;
  controller = new PowerController(
    new TauriPowerStatePort(ports.commands, ports.events),
    (isOnBatteryPower) => {
      lastKnownState = isOnBatteryPower;
      emitLocal('app/isOnBatteryPower', isOnBatteryPower);
    }
  );
  void controller.start().catch((error: unknown) => {
    console.error('Failed to start power-source monitoring.', error);
  });
};

export const battery = {
  listenForBatteryPowerStateChanges: (callback: BatteryCallback): void => {
    subscribe('app/isOnBatteryPower', callback, scalarPayload<boolean>);
    ensureControllerStarted();
    if (lastKnownState !== undefined) callback(undefined, lastKnownState);
  },
  stopListeningForBatteryPowerStateChanges: (callback: BatteryCallback): void =>
    unsubscribe('app/isOnBatteryPower', callback)
};
