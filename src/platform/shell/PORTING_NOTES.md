# Shell integration notes

## Renderer/bootstrap wiring

Create the controllers before React mounts. Start the taskbar, theme, geometry, tray and single-instance listeners first; then call `WindowGeometryController.restore('normal')`. Call `SingleInstanceController.markRendererReady()` only after the renderer callbacks used by `openAuthUri` and `openAudioFile` are installed, so arguments received during startup are drained in order.

The existing user-data store can be connected through `createGeometryRepository` and `createThemeRepository`. Player queue changes call `TaskbarController.update`, player mode changes call `WindowGeometryController.changeMode`, and the custom titlebar delegates to `TitlebarController`. Theme's `nativeThemeChanged` callback must refresh the taskbar state so its light/dark native icons follow Windows even when Nora uses an explicit app theme.

## Native additions still required

`@tauri-apps/plugin-os` 2.x exposes OS identity, version, architecture, locale and hostname only; it has no battery or power-source API. Add a Windows Rust command named `get_power_state` returning the camel-case payload `{ isOnBatteryPower: boolean }` from `GetSystemPowerStatus`, plus a `WM_POWERBROADCAST` listener for `PBT_APMPOWERSTATUSCHANGE` that emits `nora://power-source-changed` with the same payload. Register the command in `generate_handler!`; the TypeScript `TauriPowerStatePort` is already wired to that exact contract and coalesces duplicate notifications.

Tauri's window `onScaleChanged` covers scale-factor changes, but there is no global monitor-topology listener in the current Rust shell. Emit `nora://display-changed` from a native `WM_DISPLAYCHANGE` hook (and after monitor connection/removal detection); `WindowGeometryController` already subscribes and calls `clamp_rect_to_single_monitor` against the live monitor list.

The existing single-instance plugin emits directly from its callback. To make a second launch lossless even if it arrives before JavaScript registers its listener, queue each argv array in Rust until the renderer acknowledges readiness, and add a `drain_pending_second_instance_args` command returning the queued arrays atomically. The TypeScript controller already queues every event it receives until `markRendererReady`, but cannot recover an event emitted before the webview listener exists.

## Capability additions required

The current capability includes `core:window:default`, but its default set is read-only and does not authorize all setters used here. Add these permissions to the main-window capability:

- `core:app:allow-default-window-icon`
- `core:window:allow-set-min-size`
- `core:window:allow-set-max-size`
- `core:window:allow-set-fullscreen`
- `core:window:allow-set-background-color`

The existing `core:default`, `core:window:allow-set-position`, `core:window:allow-set-size`, `core:window:allow-set-always-on-top`, titlebar permissions, and `process:default` cover the remaining calls. No configuration files were changed because they are outside this task's ownership.
