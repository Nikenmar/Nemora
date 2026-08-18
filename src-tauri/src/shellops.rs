//! Native shell integration that a WebView cannot perform safely itself.
//!
//! This module keeps path launching, directory measurement, autostart and
//! display-sleep inhibition behind small testable seams. In particular,
//! `SetThreadExecutionState` is thread-scoped, so every sleep-state transition
//! is sent to one dedicated worker thread for the lifetime of the application.

use std::{
    fmt, fs, io,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread,
};

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::{AutoLaunchManager, ManagerExt};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellOpsErrorCode {
    InvalidPath,
    PathMetadata,
    DirectoryRead,
    SizeOverflow,
    ShellLaunch,
    LogPath,
    WindowMissing,
    AutoLaunch,
    SleepControl,
}

impl ShellOpsErrorCode {
    const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidPath => "SHELL_INVALID_PATH",
            Self::PathMetadata => "SHELL_PATH_METADATA",
            Self::DirectoryRead => "SHELL_DIRECTORY_READ",
            Self::SizeOverflow => "SHELL_SIZE_OVERFLOW",
            Self::ShellLaunch => "SHELL_LAUNCH",
            Self::LogPath => "SHELL_LOG_PATH",
            Self::WindowMissing => "SHELL_WINDOW_MISSING",
            Self::AutoLaunch => "SHELL_AUTO_LAUNCH",
            Self::SleepControl => "SHELL_SLEEP_CONTROL",
        }
    }
}

#[derive(Debug)]
struct ShellOpsError {
    code: ShellOpsErrorCode,
    path: Option<PathBuf>,
    detail: String,
}

impl ShellOpsError {
    fn new(code: ShellOpsErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            path: None,
            detail: detail.into(),
        }
    }

    fn at(code: ShellOpsErrorCode, path: &Path, detail: impl Into<String>) -> Self {
        Self {
            code,
            path: Some(path.to_path_buf()),
            detail: detail.into(),
        }
    }

    fn io(code: ShellOpsErrorCode, path: &Path, error: io::Error) -> Self {
        Self::at(code, path, error.to_string())
    }
}

impl fmt::Display for ShellOpsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(path) = &self.path {
            write!(
                formatter,
                "{} [{}]: {}",
                self.code.as_str(),
                path.display(),
                self.detail
            )
        } else {
            write!(formatter, "{}: {}", self.code.as_str(), self.detail)
        }
    }
}

fn checked_path(path: &Path) -> Result<PathBuf, ShellOpsError> {
    if path.as_os_str().is_empty() {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::InvalidPath,
            "path must not be empty",
        ));
    }
    fs::symlink_metadata(&path)
        .map_err(|error| ShellOpsError::io(ShellOpsErrorCode::PathMetadata, &path, error))?;
    Ok(path.to_path_buf())
}

#[cfg(windows)]
fn wide(value: &std::ffi::OsStr) -> Result<Vec<u16>, ShellOpsError> {
    use std::os::windows::ffi::OsStrExt;

    let mut value: Vec<u16> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::InvalidPath,
            "value contains an interior NUL",
        ));
    }
    value.push(0);
    Ok(value)
}

#[cfg(windows)]
fn shell_execute(
    file: &std::ffi::OsStr,
    parameters: Option<&std::ffi::OsStr>,
) -> Result<(), ShellOpsError> {
    use windows::{
        core::PCWSTR,
        Win32::{UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL},
    };

    let operation = wide(std::ffi::OsStr::new("open"))?;
    let file = wide(file)?;
    let parameters = parameters.map(wide).transpose()?;
    let parameters = parameters
        .as_ref()
        .map_or(PCWSTR::null(), |value| PCWSTR::from_raw(value.as_ptr()));

    // SAFETY: every PCWSTR points to a live NUL-terminated buffer for the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR::from_raw(operation.as_ptr()),
            PCWSTR::from_raw(file.as_ptr()),
            parameters,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    let status = result.0 as isize;
    if status <= 32 {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::ShellLaunch,
            format!("ShellExecuteW returned status {status}"),
        ));
    }
    Ok(())
}

/// Initializes COM for the calling thread, reporting whether we owe an uninit.
///
/// Same shape as the one in `taskbar.rs`, and for the same reason: a Tauri
/// command runs on whichever thread the async runtime hands it, so neither the
/// initialized state nor the apartment model can be assumed.
#[cfg(windows)]
unsafe fn initialize_com() -> Result<bool, ShellOpsError> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

    let result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    if result.is_ok() {
        Ok(true)
    } else if result == RPC_E_CHANGED_MODE {
        // The thread is already in another apartment. COM is usable; this call
        // simply must not be balanced with CoUninitialize.
        Ok(false)
    } else {
        Err(ShellOpsError::new(
            ShellOpsErrorCode::ShellLaunch,
            format!("failed to initialize COM to reveal an item: {result:?}"),
        ))
    }
}

/// Opens the containing folder and SELECTS the item, by item id rather than by
/// command line.
///
/// This used to spawn `explorer.exe /select,"<path>"`, which is the spelling
/// every answer on the internet gives and which does not work: Explorer takes
/// everything after the comma literally, the quotes become part of the name it
/// searches for, nothing matches, and it settles for showing the folder with
/// NOTHING selected. That is the whole bug, and it was invisible from inside
/// the process - `ShellExecuteW` returns success, because launching Explorer is
/// exactly what it did.
///
/// Dropping the quotes fixes that path and breaks a more common one: a comma in
/// the file name then ends the argument early and Explorer opens no window at
/// all. Music libraries are full of commas (`Artist1, Artist2 - Title.flac`).
/// Both behaviours were measured on Windows 11, not reasoned about.
///
/// `SHOpenFolderAndSelectItems` takes a parsed item id list, so there is no
/// command line to quote and no character is special.
///
/// WHICH FORM OF THAT CALL matters, and the difference is only visible with a
/// COLD folder. Passing the file itself as the folder argument with an empty
/// selection is the popular shorthand for "select this in its parent", and it
/// selects nothing unless a window for that folder is ALREADY open: the
/// shorthand makes Explorer resolve the parent and apply the selection through
/// the caller's COM apartment, which a Tauri command thread tears down the
/// moment the command returns. The documented form - the parent as the folder,
/// the file as a one-element selection - hands Explorer everything up front and
/// survives that. Measured with the folder closed, on Windows 11:
///
/// | form                       | uninitialize at once | apartment kept alive |
/// |----------------------------|----------------------|----------------------|
/// | file, empty selection      | NOTHING selected     | selected             |
/// | parent + one item          | selected             | selected             |
///
/// Every one of those returned `S_OK`, including the row that did nothing.
///
/// A path with no parent is a drive root. There is nothing to select it in, so
/// it is opened rather than revealed.
///
/// THE COLD FOLDER, ATTEMPT FOUR. The documented form above is necessary and
/// was still not sufficient: with no window open on the folder, the first click
/// opened the folder and selected nothing, and a second click - now that the
/// window existed - selected correctly. Every call returned `S_OK` throughout.
///
/// The difference between the two clicks is who has to create the window.
/// Selecting inside a window that already exists is a message to a live
/// Explorer view. Creating one is a cross-process affair, and the shell
/// finishes it by calling BACK into the apartment of whoever asked. That is
/// where this failed: the call ran on the thread Tauri handed the command,
/// which is a worker thread with no message loop. An STA without a pump can
/// issue outbound calls perfectly well and can service nothing coming the other
/// way, so the selection half of the operation had nowhere to land - and since
/// the shell reports the launch, not the selection, the return value stayed
/// `S_OK` and no log line ever appeared.
///
/// So the reveal now runs on a thread of its own that keeps its apartment alive
/// and PUMPS it, and repeats the call while it waits. The repeat is deliberate
/// belt and braces rather than superstition: it is exactly what the user did by
/// hand and observed to work, and by the second attempt the window exists, so
/// it takes the cheap path that never needed a pump. Repeating is harmless -
/// the shell navigates the window it already opened instead of opening another.
///
/// Only the first attempt is reported back. The caller gets its answer in
/// milliseconds and the thread keeps working; a failure worth showing the user
/// (a path the shell cannot parse, a missing file) is decided before any of the
/// waiting begins.
#[cfg(windows)]
fn reveal_item(path: &Path) -> Result<(), ShellOpsError> {
    let owned = path.to_path_buf();
    let (sender, receiver) = mpsc::channel();

    thread::spawn(move || unsafe { reveal_on_shell_thread(&owned, &sender) });

    // A thread that never answers is not evidence of failure: the shell may
    // simply be slow to start Explorer. Waiting longer than this would hold the
    // command open for no benefit, since the retries continue regardless.
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap_or(Ok(()))
}

#[cfg(windows)]
const REVEAL_RETRIES: u8 = 2;
#[cfg(windows)]
const REVEAL_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(400);
#[cfg(windows)]
const REVEAL_SETTLE: std::time::Duration = std::time::Duration::from_millis(250);

/// Runs the shell call on a thread that owns its apartment, and reports only
/// the first attempt to `first_attempt`.
///
/// SAFETY: every id list is freed before returning, the wide buffers outlive
/// every call that reads them, and COM is balanced only when this thread
/// initialised it.
#[cfg(windows)]
unsafe fn reveal_on_shell_thread(
    path: &Path,
    first_attempt: &mpsc::Sender<Result<(), ShellOpsError>>,
) {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::CoUninitialize;
    use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

    let report = |outcome: Result<(), ShellOpsError>| {
        let _ = first_attempt.send(outcome);
    };

    let item_path = match wide(path.as_os_str()) {
        Ok(value) => value,
        Err(error) => return report(Err(error)),
    };
    let parent_path = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => match wide(parent.as_os_str()) {
            Ok(value) => Some(value),
            Err(error) => return report(Err(error)),
        },
        _ => None,
    };

    let balance_com = match initialize_com() {
        Ok(value) => value,
        Err(error) => return report(Err(error)),
    };

    let item = ILCreateFromPathW(PCWSTR::from_raw(item_path.as_ptr()));
    let parent = parent_path
        .as_ref()
        .map(|value| ILCreateFromPathW(PCWSTR::from_raw(value.as_ptr())));

    if item.is_null() || parent.is_some_and(|pidl| pidl.is_null()) {
        report(Err(ShellOpsError::at(
            ShellOpsErrorCode::InvalidPath,
            path,
            "the shell could not parse this path into an item",
        )));
    } else {
        let select = || match parent {
            Some(folder) => SHOpenFolderAndSelectItems(folder, Some(&[item.cast_const()]), 0),
            None => SHOpenFolderAndSelectItems(item, None, 0),
        };

        report(select().map_err(|error| {
            ShellOpsError::at(ShellOpsErrorCode::ShellLaunch, path, error.to_string())
        }));

        for _ in 0..REVEAL_RETRIES {
            pump_apartment(REVEAL_RETRY_DELAY);
            let _ = select();
        }
        pump_apartment(REVEAL_SETTLE);
    }

    if !item.is_null() {
        ILFree(Some(item));
    }
    if let Some(pidl) = parent.filter(|pidl| !pidl.is_null()) {
        ILFree(Some(pidl));
    }
    if balance_com {
        CoUninitialize();
    }
}

/// Services this thread's apartment for `duration`.
///
/// Sleeping instead would leave the STA deaf: an apartment-threaded COM object
/// receives incoming calls as window messages, so a thread that does not
/// dispatch them cannot complete anything the shell asks of it. This is the
/// half the old implementation was missing.
#[cfg(windows)]
unsafe fn pump_apartment(duration: std::time::Duration) {
    use std::time::Instant;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };

    let deadline = Instant::now() + duration;
    let mut message = MSG::default();
    while Instant::now() < deadline {
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[cfg(target_os = "macos")]
fn reveal_item(path: &Path) -> Result<(), ShellOpsError> {
    spawn_command("open", &[std::ffi::OsStr::new("-R"), path.as_os_str()])
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn reveal_item(path: &Path) -> Result<(), ShellOpsError> {
    let parent = if path.is_dir() {
        path.parent().unwrap_or(path)
    } else {
        path.parent().unwrap_or_else(|| Path::new("."))
    };
    spawn_command("xdg-open", &[parent.as_os_str()])
}

#[cfg(not(windows))]
fn spawn_command(program: &str, arguments: &[&std::ffi::OsStr]) -> Result<(), ShellOpsError> {
    std::process::Command::new(program)
        .args(arguments)
        .spawn()
        .map(|_| ())
        .map_err(|error| ShellOpsError::new(ShellOpsErrorCode::ShellLaunch, error.to_string()))
}

#[cfg(windows)]
fn open_in_default_handler(path: &Path) -> Result<(), ShellOpsError> {
    shell_execute(path.as_os_str(), None)
}

#[cfg(target_os = "macos")]
fn open_in_default_handler(path: &Path) -> Result<(), ShellOpsError> {
    spawn_command("open", &[path.as_os_str()])
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_in_default_handler(path: &Path) -> Result<(), ShellOpsError> {
    spawn_command("xdg-open", &[path.as_os_str()])
}

/// Moves a file to the recycle bin, keeping it restorable.
///
/// `FOF_ALLOWUNDO` is the whole point: a plain delete is what
/// `permanentlyDeleteFile` already does, and the renderer offers these as two
/// different choices. `FOF_NOCONFIRMATION` and `FOF_SILENT` keep the shell from
/// opening its own dialog on top of the app's, which has already asked.
///
/// `pFrom` is a DOUBLE NUL-terminated list, not a plain string: one terminator
/// ends the path, the second ends the list. Passing a singly-terminated buffer
/// makes the shell read past it.
#[cfg(windows)]
fn move_to_recycle_bin(path: &Path) -> Result<(), ShellOpsError> {
    use windows::{
        core::PCWSTR,
        Win32::UI::Shell::{
            SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FO_DELETE,
            SHFILEOPSTRUCTW,
        },
    };

    let mut from = wide(path.as_os_str())?;
    from.push(0);

    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE as u32,
        pFrom: PCWSTR::from_raw(from.as_ptr()),
        // FILEOPERATION_FLAGS wraps a u32 while the struct field is a u16; the
        // three flags used here all fit, but the narrowing has to be written out.
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT).0 as u16,
        ..Default::default()
    };

    // SAFETY: `pFrom` points to a live, double-NUL-terminated buffer that
    // outlives the call, and every other field is either zeroed or set above.
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::ShellLaunch,
            format!("SHFileOperationW returned {result}"),
        ));
    }
    if operation.fAnyOperationsAborted.as_bool() {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::ShellLaunch,
            "the recycle-bin operation was aborted",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn move_to_recycle_bin(path: &Path) -> Result<(), ShellOpsError> {
    Err(ShellOpsError::new(
        ShellOpsErrorCode::ShellLaunch,
        format!(
            "moving {} to a recycle bin is not implemented on this platform",
            path.display()
        ),
    ))
}

/// Backs `services.moveFileToTrash`, which the renderer calls for a
/// non-permanent delete.
///
/// The call site existed with no command behind it: `invoke('trash_item')` was
/// written against a command that was never registered, so every "move to the
/// recycle bin" ended in a rejected promise.
#[tauri::command]
pub fn trash_item(path: String) -> Result<(), String> {
    let path = checked_path(Path::new(&path)).map_err(|error| error.to_string())?;
    move_to_recycle_bin(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_song_in_file_explorer(path: String) -> Result<(), String> {
    let path = checked_path(Path::new(&path)).map_err(|error| error.to_string())?;
    reveal_item(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_folder_in_file_explorer(path: String) -> Result<(), String> {
    let path = checked_path(Path::new(&path)).map_err(|error| error.to_string())?;
    reveal_item(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_log_file(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_log_dir()
        .map_err(|error| {
            ShellOpsError::new(ShellOpsErrorCode::LogPath, error.to_string()).to_string()
        })?
        .join(&app.package_info().name)
        .with_extension("log");
    checked_path(&path).map_err(|error| error.to_string())?;
    open_in_default_handler(&path).map_err(|error| error.to_string())
}

fn directory_size_impl(path: &Path) -> Result<u64, ShellOpsError> {
    let root = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(ShellOpsError::io(
                ShellOpsErrorCode::PathMetadata,
                path,
                error,
            ));
        }
    };
    if root.file_type().is_symlink() {
        return Ok(0);
    }
    if root.is_file() {
        return Ok(root.len());
    }
    if !root.is_dir() {
        return Ok(0);
    }

    let mut total = 0_u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            ShellOpsError::io(ShellOpsErrorCode::DirectoryRead, &directory, error)
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                ShellOpsError::io(ShellOpsErrorCode::DirectoryRead, &directory, error)
            })?;
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).map_err(|error| {
                ShellOpsError::io(ShellOpsErrorCode::PathMetadata, &entry_path, error)
            })?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(entry_path);
            } else if metadata.is_file() {
                total = total.checked_add(metadata.len()).ok_or_else(|| {
                    ShellOpsError::at(
                        ShellOpsErrorCode::SizeOverflow,
                        path,
                        "directory size exceeds u64",
                    )
                })?;
            }
        }
    }
    Ok(total)
}

#[tauri::command]
pub async fn directory_size(path: String) -> Result<u64, String> {
    let error_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || directory_size_impl(Path::new(&path)))
        .await
        .map_err(|error| {
            ShellOpsError::at(
                ShellOpsErrorCode::DirectoryRead,
                &error_path,
                error.to_string(),
            )
            .to_string()
        })?
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn paths_share_volume_impl(first: &Path, second: &Path) -> Result<bool, ShellOpsError> {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetVolumePathNameW};

    fn volume_root(path: &Path) -> Result<String, ShellOpsError> {
        fs::metadata(path)
            .map_err(|error| ShellOpsError::io(ShellOpsErrorCode::PathMetadata, path, error))?;
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map_err(|error| ShellOpsError::io(ShellOpsErrorCode::PathMetadata, path, error))?
                .join(path)
        };
        let input = wide(absolute.as_os_str())?;
        let mut output = vec![0_u16; 32_768];
        // SAFETY: input is NUL-terminated and output is writable for its full length.
        unsafe { GetVolumePathNameW(PCWSTR::from_raw(input.as_ptr()), &mut output) }.map_err(
            |error| ShellOpsError::at(ShellOpsErrorCode::PathMetadata, path, error.to_string()),
        )?;
        let length = output
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(output.len());
        Ok(String::from_utf16_lossy(&output[..length]).to_lowercase())
    }

    Ok(volume_root(first)? == volume_root(second)?)
}

#[cfg(unix)]
fn paths_share_volume_impl(first: &Path, second: &Path) -> Result<bool, ShellOpsError> {
    use std::os::unix::fs::MetadataExt;

    let first_device = fs::metadata(first)
        .map_err(|error| ShellOpsError::io(ShellOpsErrorCode::PathMetadata, first, error))?
        .dev();
    let second_device = fs::metadata(second)
        .map_err(|error| ShellOpsError::io(ShellOpsErrorCode::PathMetadata, second, error))?
        .dev();
    Ok(first_device == second_device)
}

#[tauri::command]
pub async fn paths_share_volume(first: String, second: String) -> Result<bool, String> {
    let first_path = PathBuf::from(&first);
    let second_path = PathBuf::from(&second);
    tauri::async_runtime::spawn_blocking(move || paths_share_volume_impl(&first_path, &second_path))
        .await
        .map_err(|error| {
            ShellOpsError::new(ShellOpsErrorCode::PathMetadata, error.to_string()).to_string()
        })?
        .map_err(|error| error.to_string())
}

trait AutoLaunchBackend {
    fn enable(&self) -> Result<(), String>;
    fn disable(&self) -> Result<(), String>;
    fn is_enabled(&self) -> Result<bool, String>;
}

impl AutoLaunchBackend for AutoLaunchManager {
    fn enable(&self) -> Result<(), String> {
        AutoLaunchManager::enable(self).map_err(|error| error.to_string())
    }

    fn disable(&self) -> Result<(), String> {
        AutoLaunchManager::disable(self).map_err(|error| error.to_string())
    }

    fn is_enabled(&self) -> Result<bool, String> {
        AutoLaunchManager::is_enabled(self).map_err(|error| error.to_string())
    }
}

fn set_auto_launch(backend: &dyn AutoLaunchBackend, enabled: bool) -> Result<(), ShellOpsError> {
    if enabled {
        backend.enable()
    } else {
        backend.disable()
    }
    .map_err(|error| ShellOpsError::new(ShellOpsErrorCode::AutoLaunch, error))?;

    let actual = backend
        .is_enabled()
        .map_err(|error| ShellOpsError::new(ShellOpsErrorCode::AutoLaunch, error))?;
    if actual != enabled {
        return Err(ShellOpsError::new(
            ShellOpsErrorCode::AutoLaunch,
            format!("requested enabled={enabled}, but registration reports enabled={actual}"),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_auto_launch(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    set_auto_launch(&*manager, enabled).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_devtools(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| {
        ShellOpsError::new(
            ShellOpsErrorCode::WindowMissing,
            "main webview does not exist",
        )
        .to_string()
    })?;
    window.open_devtools();
    Ok(())
}

trait ExecutionStateBackend: Send + 'static {
    fn allow_display_sleep(&mut self) -> Result<(), String>;
    fn prevent_display_sleep(&mut self) -> Result<(), String>;
}

#[cfg(windows)]
struct SystemExecutionState;

#[cfg(windows)]
impl ExecutionStateBackend for SystemExecutionState {
    fn allow_display_sleep(&mut self) -> Result<(), String> {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};

        // SAFETY: this sets state only for the dedicated worker thread.
        let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        if previous.0 == 0 {
            Err(io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }

    fn prevent_display_sleep(&mut self) -> Result<(), String> {
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
        };

        // SAFETY: this sets state only for the dedicated worker thread.
        let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED) };
        if previous.0 == 0 {
            Err(io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(windows))]
struct SystemExecutionState;

#[cfg(not(windows))]
impl ExecutionStateBackend for SystemExecutionState {
    fn allow_display_sleep(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn prevent_display_sleep(&mut self) -> Result<(), String> {
        Err("display-sleep inhibition is currently supported only on Windows".to_string())
    }
}

fn apply_sleep_state(
    backend: &mut dyn ExecutionStateBackend,
    preventing: &mut bool,
    prevent: bool,
) -> Result<(), ShellOpsError> {
    if prevent {
        // Release first even when already active. This makes repeated calls
        // idempotent and ensures a failed re-acquire cannot leave a stale pin.
        backend
            .allow_display_sleep()
            .map_err(|error| ShellOpsError::new(ShellOpsErrorCode::SleepControl, error))?;
        *preventing = false;
        backend
            .prevent_display_sleep()
            .map_err(|error| ShellOpsError::new(ShellOpsErrorCode::SleepControl, error))?;
        *preventing = true;
    } else {
        // Never skip release based on cached state: the OS state is authoritative.
        let result = backend.allow_display_sleep();
        *preventing = false;
        result.map_err(|error| ShellOpsError::new(ShellOpsErrorCode::SleepControl, error))?;
    }
    Ok(())
}

struct SleepRequest {
    prevent: bool,
    response: mpsc::SyncSender<Result<(), String>>,
}

#[derive(Default)]
pub struct ScreenSleepState {
    sender: Mutex<Option<mpsc::Sender<SleepRequest>>>,
}

impl ScreenSleepState {
    fn set_preventing(&self, prevent: bool) -> Result<(), String> {
        let mut sender = self.sender.lock().map_err(|_| {
            ShellOpsError::new(ShellOpsErrorCode::SleepControl, "sleep mutex is poisoned")
                .to_string()
        })?;
        if sender.is_none() {
            let (request_sender, request_receiver) = mpsc::channel::<SleepRequest>();
            thread::Builder::new()
                .name("nora-display-sleep".to_string())
                .spawn(move || {
                    let mut backend = SystemExecutionState;
                    let mut preventing = false;
                    while let Ok(request) = request_receiver.recv() {
                        let result =
                            apply_sleep_state(&mut backend, &mut preventing, request.prevent)
                                .map_err(|error| error.to_string());
                        let _ = request.response.send(result);
                    }
                    // Channel closure means the app state is going away. Always
                    // release once more instead of relying on cached state.
                    let _ = apply_sleep_state(&mut backend, &mut preventing, false);
                })
                .map_err(|error| {
                    ShellOpsError::new(ShellOpsErrorCode::SleepControl, error.to_string())
                        .to_string()
                })?;
            *sender = Some(request_sender);
        }

        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        sender
            .as_ref()
            .ok_or_else(|| {
                ShellOpsError::new(
                    ShellOpsErrorCode::SleepControl,
                    "sleep worker was not initialized",
                )
                .to_string()
            })?
            .send(SleepRequest {
                prevent,
                response: response_sender,
            })
            .map_err(|error| {
                ShellOpsError::new(ShellOpsErrorCode::SleepControl, error.to_string()).to_string()
            })?;
        response_receiver.recv().map_err(|error| {
            ShellOpsError::new(ShellOpsErrorCode::SleepControl, error.to_string()).to_string()
        })?
    }
}

#[tauri::command]
pub fn stop_screen_sleeping(state: tauri::State<'_, ScreenSleepState>) -> Result<(), String> {
    state.set_preventing(true)
}

#[tauri::command]
pub fn allow_screen_sleeping(state: tauri::State<'_, ScreenSleepState>) -> Result<(), String> {
    state.set_preventing(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct FakeAutoLaunch {
        enabled: Cell<bool>,
    }

    impl AutoLaunchBackend for FakeAutoLaunch {
        fn enable(&self) -> Result<(), String> {
            self.enabled.set(true);
            Ok(())
        }

        fn disable(&self) -> Result<(), String> {
            self.enabled.set(false);
            Ok(())
        }

        fn is_enabled(&self) -> Result<bool, String> {
            Ok(self.enabled.get())
        }
    }

    #[derive(Default)]
    struct FakeExecutionState {
        calls: RefCell<Vec<&'static str>>,
    }

    impl ExecutionStateBackend for FakeExecutionState {
        fn allow_display_sleep(&mut self) -> Result<(), String> {
            self.calls.borrow_mut().push("allow");
            Ok(())
        }

        fn prevent_display_sleep(&mut self) -> Result<(), String> {
            self.calls.borrow_mut().push("prevent");
            Ok(())
        }
    }

    fn temporary_directory() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("nora-shellops-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn directory_size_counts_nested_files_and_missing_paths_are_zero() {
        let root = temporary_directory();
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create test directory");
        fs::write(root.join("one.bin"), [1_u8, 2, 3]).expect("write first test file");
        fs::write(nested.join("two.bin"), [4_u8, 5]).expect("write nested test file");

        assert_eq!(directory_size_impl(&root).expect("measure directory"), 5);
        assert_eq!(
            directory_size_impl(&root.join("missing")).expect("measure missing"),
            0
        );

        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn auto_launch_backend_is_changed_and_verified() {
        let backend = FakeAutoLaunch {
            enabled: Cell::new(false),
        };
        set_auto_launch(&backend, true).expect("enable autostart");
        assert!(backend.enabled.get());
        set_auto_launch(&backend, false).expect("disable autostart");
        assert!(!backend.enabled.get());
    }

    #[test]
    fn sleep_release_is_unconditional_and_repeated_prevent_releases_first() {
        let mut backend = FakeExecutionState::default();
        let mut preventing = false;

        apply_sleep_state(&mut backend, &mut preventing, false).expect("first release");
        apply_sleep_state(&mut backend, &mut preventing, false).expect("idempotent release");
        apply_sleep_state(&mut backend, &mut preventing, true).expect("prevent sleep");
        apply_sleep_state(&mut backend, &mut preventing, true).expect("repeat prevent sleep");

        assert!(preventing);
        assert_eq!(
            backend.calls.into_inner(),
            vec!["allow", "allow", "allow", "prevent", "allow", "prevent"]
        );
    }

    // Revealing an item has no ordinary unit test, and that is the point.
    //
    // The one that stood here asserted the command line came out as
    // `/select,"E:\Music folder\song.flac"`, and it passed while the feature
    // did not work: the string was exactly what the code meant to build, and
    // what a string comparison cannot know is that Explorer then selects
    // nothing. Testing the shape of a request to another program proves the
    // shape and nothing else.
    //
    // What follows opens a real Explorer window instead, which is why it is
    // opt-in twice: ignored by default, and inert unless a path is named.
    //
    //   $env:NEMORA_REVEAL_TEST = 'E:\Music\Some, Artist - Track.flac'
    //   cargo test --manifest-path src-tauri/Cargo.toml reveals_a_real_item -- --ignored --nocapture
    //
    // CLOSE EVERY WINDOW ON THAT FOLDER FIRST. With one already open, all
    // three broken spellings of this call look correct, which is exactly how
    // the second bug survived the fix for the first. And read the result off
    // the screen: success here means the shell accepted the request, and every
    // version that selected nothing also returned success.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn reveals_a_real_item() {
        let Ok(target) = std::env::var("NEMORA_REVEAL_TEST") else {
            println!("set NEMORA_REVEAL_TEST to the full path of a file");
            return;
        };
        reveal_item(Path::new(&target)).expect("the shell should accept the item");
        // The command returns as soon as the first attempt is answered, and the
        // retries that actually make a cold folder select run on after it. A
        // test binary that returned here would kill that thread and measure the
        // very failure this exists to catch; the application outlives it.
        thread::sleep(std::time::Duration::from_secs(2));
        println!("asked Explorer to reveal {target}");
    }
}
