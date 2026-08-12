//! Windows taskbar thumbnail playback buttons (`ITaskbarList3`).
//!
//! The three buttons mirror Electron's Previous, Play/Pause and Next controls.
//! A Win32 subclass receives their `WM_COMMAND` notifications and the
//! registered `TaskbarButtonCreated` message used after Explorer restarts.

use serde::Deserialize;

const PREVIOUS_BUTTON_ID: u32 = 1;
const PLAY_PAUSE_BUTTON_ID: u32 = 2;
const NEXT_BUTTON_ID: u32 = 3;
const BUTTON_COUNT: usize = 3;
const WINDOWS_THUMBBAR_BUTTON_LIMIT: usize = 7;

const PREVIOUS_EVENT: &str = "nemora://taskbar/previous";
const PLAY_PAUSE_EVENT: &str = "nemora://taskbar/play-pause";
const NEXT_EVENT: &str = "nemora://taskbar/next";

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarButtonState {
    pub is_playing: bool,
    pub has_previous: bool,
    pub has_next: bool,
    #[serde(default = "default_true")]
    pub is_playback_supported: bool,
    #[serde(default)]
    pub is_dark_mode: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IconKind {
    Previous,
    Play,
    Pause,
    Next,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ButtonSpec {
    id: u32,
    tooltip: &'static str,
    icon: IconKind,
    enabled: bool,
    event: &'static str,
}

fn button_specs(state: TaskbarButtonState) -> [ButtonSpec; BUTTON_COUNT] {
    [
        ButtonSpec {
            id: PREVIOUS_BUTTON_ID,
            tooltip: "Skip Back",
            icon: IconKind::Previous,
            enabled: state.is_playback_supported && state.has_previous,
            event: PREVIOUS_EVENT,
        },
        ButtonSpec {
            id: PLAY_PAUSE_BUTTON_ID,
            tooltip: if state.is_playing { "Pause" } else { "Play" },
            icon: if state.is_playing {
                IconKind::Pause
            } else {
                IconKind::Play
            },
            enabled: state.is_playback_supported,
            event: PLAY_PAUSE_EVENT,
        },
        ButtonSpec {
            id: NEXT_BUTTON_ID,
            tooltip: "Skip forward",
            icon: IconKind::Next,
            enabled: state.is_playback_supported && state.has_next,
            event: NEXT_EVENT,
        },
    ]
}

#[cfg(windows)]
mod platform {
    use super::{button_specs, ButtonSpec, IconKind, TaskbarButtonState, BUTTON_COUNT};
    use std::{sync::mpsc, time::Duration};
    use tauri::Emitter;
    use windows::{
        core::w,
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, RPC_E_CHANGED_MODE, WPARAM},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::{
                Shell::{
                    DefSubclassProc, GetWindowSubclass, ITaskbarList3, RemoveWindowSubclass,
                    SetWindowSubclass, TaskbarList, THBF_DISABLED, THBF_ENABLED, THBF_HIDDEN,
                    THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
                },
                WindowsAndMessaging::{
                    CreateIconFromResourceEx, DestroyIcon, RegisterWindowMessageW, HICON,
                    LR_DEFAULTCOLOR, WM_COMMAND, WM_NCDESTROY,
                },
            },
        },
    };

    const SUBCLASS_ID: usize = 0x4e4f_5241; // "NORA"
    const ICON_RESOURCE_VERSION: u32 = 0x0003_0000;
    const ICON_SIZE: i32 = 48;
    const COMMAND_TIMEOUT: Duration = Duration::from_secs(3);

    #[repr(align(4))]
    struct AlignedBytes<const N: usize>([u8; N]);

    static PREVIOUS_DARK: AlignedBytes<221> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_skip_previous_black_24dp.png"
    ));
    static PREVIOUS_LIGHT: AlignedBytes<219> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_skip_previous_white_24dp.png"
    ));
    static PLAY_DARK: AlignedBytes<212> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_play_arrow_black_24dp.png"
    ));
    static PLAY_LIGHT: AlignedBytes<210> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_play_arrow_white_24dp.png"
    ));
    static PAUSE_DARK: AlignedBytes<103> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/outline_pause_black_24dp.png"
    ));
    static PAUSE_LIGHT: AlignedBytes<90> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/outline_pause_white_24dp.png"
    ));
    static NEXT_DARK: AlignedBytes<214> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_skip_next_black_24dp.png"
    ));
    static NEXT_LIGHT: AlignedBytes<211> = AlignedBytes(*include_bytes!(
        "../../resources/taskbar buttons/baseline_skip_next_white_24dp.png"
    ));

    struct OwnedIcon(HICON);

    impl Drop for OwnedIcon {
        fn drop(&mut self) {
            if !self.0.is_invalid() {
                let _ = unsafe { DestroyIcon(self.0) };
            }
        }
    }

    fn icon_bytes(kind: IconKind, dark_mode: bool) -> &'static [u8] {
        // A dark taskbar needs the white assets, matching Electron's
        // `nativeTheme.shouldUseDarkColors` branch.
        match (kind, dark_mode) {
            (IconKind::Previous, true) => &PREVIOUS_LIGHT.0,
            (IconKind::Previous, false) => &PREVIOUS_DARK.0,
            (IconKind::Play, true) => &PLAY_LIGHT.0,
            (IconKind::Play, false) => &PLAY_DARK.0,
            (IconKind::Pause, true) => &PAUSE_LIGHT.0,
            (IconKind::Pause, false) => &PAUSE_DARK.0,
            (IconKind::Next, true) => &NEXT_LIGHT.0,
            (IconKind::Next, false) => &NEXT_DARK.0,
        }
    }

    fn load_icon(kind: IconKind, dark_mode: bool) -> Result<OwnedIcon, String> {
        // Vista and newer accept PNG-compressed icon resource bits here. This
        // keeps the exact shipped PNG pixels without adding a decoder or a
        // second set of generated assets.
        unsafe {
            CreateIconFromResourceEx(
                icon_bytes(kind, dark_mode),
                true,
                ICON_RESOURCE_VERSION,
                ICON_SIZE,
                ICON_SIZE,
                LR_DEFAULTCOLOR,
            )
        }
        .map(OwnedIcon)
        .map_err(|error| format!("failed to decode taskbar icon: {error}"))
    }

    fn tooltip(text: &str) -> [u16; 260] {
        let mut output = [0; 260];
        for (destination, source) in output.iter_mut().take(259).zip(text.encode_utf16()) {
            *destination = source;
        }
        output
    }

    fn native_button(spec: ButtonSpec, icon: HICON, hidden: bool) -> THUMBBUTTON {
        THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: spec.id,
            iBitmap: 0,
            hIcon: icon,
            szTip: tooltip(spec.tooltip),
            dwFlags: if hidden {
                THBF_HIDDEN
            } else if spec.enabled {
                THBF_ENABLED
            } else {
                THBF_DISABLED
            },
        }
    }

    fn create_taskbar() -> Result<ITaskbarList3, String> {
        let taskbar: ITaskbarList3 =
            unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                .map_err(|error| format!("failed to create ITaskbarList3: {error}"))?;
        unsafe { taskbar.HrInit() }
            .map_err(|error| format!("ITaskbarList3::HrInit failed: {error}"))?;
        Ok(taskbar)
    }

    struct SubclassState {
        window: tauri::Window,
        taskbar: ITaskbarList3,
        buttons: TaskbarButtonState,
        buttons_added: bool,
        visible: bool,
        balance_com: bool,
    }

    impl SubclassState {
        fn apply(&mut self, hwnd: HWND) -> Result<(), String> {
            if !self.visible && !self.buttons_added {
                return Ok(());
            }
            debug_assert!(BUTTON_COUNT <= super::WINDOWS_THUMBBAR_BUTTON_LIMIT);
            let specs = button_specs(self.buttons);
            let icons = specs
                .iter()
                .map(|spec| load_icon(spec.icon, self.buttons.is_dark_mode))
                .collect::<Result<Vec<_>, _>>()?;
            let buttons = specs
                .iter()
                .zip(&icons)
                .map(|(spec, icon)| native_button(*spec, icon.0, !self.visible))
                .collect::<Vec<_>>();

            if self.buttons_added {
                unsafe { self.taskbar.ThumbBarUpdateButtons(hwnd, &buttons) }
                    .map_err(|error| format!("ThumbBarUpdateButtons failed: {error}"))?;
            } else {
                unsafe { self.taskbar.ThumbBarAddButtons(hwnd, &buttons) }
                    .map_err(|error| format!("ThumbBarAddButtons failed: {error}"))?;
                self.buttons_added = true;
            }
            Ok(())
        }

        fn taskbar_recreated(&mut self, hwnd: HWND) {
            self.buttons_added = false;
            match create_taskbar() {
                Ok(taskbar) => {
                    self.taskbar = taskbar;
                    if let Err(error) = self.apply(hwnd) {
                        eprintln!("failed to restore Nemora taskbar buttons: {error}");
                    }
                }
                Err(error) => eprintln!("failed to reconnect Nemora taskbar integration: {error}"),
            }
        }

        fn clicked_spec(&self, id: u32) -> Option<ButtonSpec> {
            if !self.visible {
                return None;
            }
            button_specs(self.buttons)
                .into_iter()
                .find(|button| button.id == id && button.enabled)
        }
    }

    impl Drop for SubclassState {
        fn drop(&mut self) {
            if self.balance_com {
                unsafe { CoUninitialize() };
            }
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        data: usize,
    ) -> LRESULT {
        let state = &mut *(data as *mut SubclassState);

        if message == taskbar_button_created_message() {
            state.taskbar_recreated(hwnd);
            return LRESULT(0);
        }

        if message == WM_COMMAND {
            let notification = ((wparam.0 >> 16) & 0xffff) as u32;
            let id = (wparam.0 & 0xffff) as u32;
            if notification == THBN_CLICKED {
                if let Some(spec) = state.clicked_spec(id) {
                    if let Err(error) = state.window.emit(spec.event, ()) {
                        eprintln!("failed to emit {}: {error}", spec.event);
                    }
                    return LRESULT(0);
                }
            }
        }

        if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            drop(Box::from_raw(data as *mut SubclassState));
            return result;
        }

        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    fn taskbar_button_created_message() -> u32 {
        unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) }
    }

    unsafe fn existing_state(hwnd: HWND) -> Option<&'static mut SubclassState> {
        let mut data = 0usize;
        if GetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, Some(&mut data)).as_bool()
            && data != 0
        {
            Some(&mut *(data as *mut SubclassState))
        } else {
            None
        }
    }

    unsafe fn initialize_com() -> Result<bool, String> {
        let result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if result.is_ok() {
            Ok(true)
        } else if result == RPC_E_CHANGED_MODE {
            // Tauri/WebView2 may already have initialized the UI thread using
            // another apartment model. COM is still available; this call must
            // simply not be balanced with CoUninitialize.
            Ok(false)
        } else {
            Err(format!(
                "failed to initialize COM for taskbar controls: {result:?}"
            ))
        }
    }

    unsafe fn install_state(
        hwnd: HWND,
        window: tauri::Window,
        buttons: TaskbarButtonState,
    ) -> Result<&'static mut SubclassState, String> {
        let balance_com = initialize_com()?;
        let taskbar = match create_taskbar() {
            Ok(taskbar) => taskbar,
            Err(error) => {
                if balance_com {
                    CoUninitialize();
                }
                return Err(error);
            }
        };
        let state = Box::new(SubclassState {
            window,
            taskbar,
            buttons,
            buttons_added: false,
            visible: true,
            balance_com,
        });
        let raw = Box::into_raw(state);
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, raw as usize).as_bool() {
            drop(Box::from_raw(raw));
            return Err("SetWindowSubclass failed for the Nemora window".to_owned());
        }
        Ok(&mut *raw)
    }

    fn on_window_thread<F>(window: tauri::Window, operation: F) -> Result<(), String>
    where
        F: FnOnce(HWND, tauri::Window) -> Result<(), String> + Send + 'static,
    {
        let (sender, receiver) = mpsc::sync_channel(1);
        let dispatch_window = window.clone();
        window
            .run_on_main_thread(move || {
                let result = dispatch_window
                    .hwnd()
                    .map_err(|error| error.to_string())
                    .and_then(|hwnd| operation(hwnd, dispatch_window));
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        receiver
            .recv_timeout(COMMAND_TIMEOUT)
            .map_err(|_| "timed out waiting for the window thread".to_owned())?
    }

    pub fn set(window: tauri::Window, buttons: TaskbarButtonState) -> Result<(), String> {
        on_window_thread(window, move |hwnd, window| unsafe {
            let state = match existing_state(hwnd) {
                Some(state) => state,
                None => install_state(hwnd, window, buttons)?,
            };
            state.buttons = buttons;
            state.visible = true;
            state.apply(hwnd)
        })
    }

    pub fn clear(window: tauri::Window) -> Result<(), String> {
        on_window_thread(window, move |hwnd, _window| unsafe {
            if let Some(state) = existing_state(hwnd) {
                state.visible = false;
                state.apply(hwnd)?;
            }
            Ok(())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::{load_icon, IconKind};

        #[test]
        fn all_shipped_png_resources_create_native_icons() {
            for dark_mode in [false, true] {
                for kind in [
                    IconKind::Previous,
                    IconKind::Play,
                    IconKind::Pause,
                    IconKind::Next,
                ] {
                    load_icon(kind, dark_mode).unwrap();
                }
            }
        }
    }
}

/// Installs or updates the Previous, Play/Pause and Next thumbbar buttons.
#[tauri::command]
pub async fn set_taskbar_buttons(
    window: tauri::Window,
    state: TaskbarButtonState,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        return platform::set(window, state);
    }

    #[cfg(not(windows))]
    {
        let _ = (window, state);
        Err("taskbar thumbnail buttons are only available on Windows".to_owned())
    }
}

/// Hides all Nora thumbbar buttons while retaining the subclass so a later
/// update cannot violate Windows' one-time `ThumbBarAddButtons` rule.
#[tauri::command]
pub async fn clear_taskbar_buttons(window: tauri::Window) -> Result<(), String> {
    #[cfg(windows)]
    {
        return platform::clear(window);
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        button_specs, IconKind, TaskbarButtonState, BUTTON_COUNT, NEXT_EVENT, PLAY_PAUSE_EVENT,
        PREVIOUS_EVENT, WINDOWS_THUMBBAR_BUTTON_LIMIT,
    };

    fn state() -> TaskbarButtonState {
        TaskbarButtonState {
            is_playing: false,
            has_previous: true,
            has_next: true,
            is_playback_supported: true,
            is_dark_mode: false,
        }
    }

    #[test]
    fn stays_below_windows_seven_button_limit() {
        assert_eq!(BUTTON_COUNT, 3);
        assert!(BUTTON_COUNT <= WINDOWS_THUMBBAR_BUTTON_LIMIT);
    }

    #[test]
    fn defines_the_exact_button_order_and_events() {
        let buttons = button_specs(state());
        assert_eq!(buttons[0].tooltip, "Skip Back");
        assert_eq!(buttons[0].event, PREVIOUS_EVENT);
        assert_eq!(buttons[1].tooltip, "Play");
        assert_eq!(buttons[1].event, PLAY_PAUSE_EVENT);
        assert_eq!(buttons[2].tooltip, "Skip forward");
        assert_eq!(buttons[2].event, NEXT_EVENT);
    }

    #[test]
    fn playback_state_switches_play_to_pause() {
        let mut playing = state();
        playing.is_playing = true;
        let play_pause = button_specs(playing)[1];
        assert_eq!(play_pause.tooltip, "Pause");
        assert_eq!(play_pause.icon, IconKind::Pause);
    }

    #[test]
    fn availability_disables_navigation_independently() {
        let mut unavailable = state();
        unavailable.has_previous = false;
        unavailable.has_next = false;
        let buttons = button_specs(unavailable);
        assert!(!buttons[0].enabled);
        assert!(buttons[1].enabled);
        assert!(!buttons[2].enabled);
    }

    #[test]
    fn unsupported_playback_disables_all_three_buttons() {
        let mut unsupported = state();
        unsupported.is_playback_supported = false;
        assert!(button_specs(unsupported)
            .into_iter()
            .all(|button| !button.enabled));
    }
}
