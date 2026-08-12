//! Names Nemora's entry in the Windows volume mixer.
//!
//! Audio is produced by the WebView2 process, so Windows registers the session
//! under `msedgewebview2` with the Edge icon. Electron had the same structure
//! but its renderer was part of the app, so the mixer showed "Nora".
//!
//! The session belongs to a child process, not to us, so it cannot be labelled
//! at creation. Instead the session enumerator is walked, sessions owned by our
//! own process tree are picked out by process id, and their display name and
//! icon are set. The session only exists once something actually plays, so this
//! runs on a poll rather than once at startup.

#![cfg(windows)]

use std::collections::HashSet;

use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Our process and every process descending from it, so the WebView2 children
/// that actually own the audio session are included.
fn own_process_tree() -> HashSet<u32> {
    let mut tree = HashSet::new();
    tree.insert(std::process::id());

    let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
        Ok(handle) => handle,
        Err(_) => return tree,
    };

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut pairs: Vec<(u32, u32)> = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };

    // A few passes are enough: WebView2 nests only a couple of levels deep.
    for _ in 0..4 {
        for (pid, parent) in &pairs {
            if tree.contains(parent) {
                tree.insert(*pid);
            }
        }
    }
    tree
}

/// Relabels any mixer session owned by this app. Returns how many it renamed.
fn label_sessions(display_name: &str, icon_path: &str) -> windows::core::Result<usize> {
    let tree = own_process_tree();
    let mut renamed = 0usize;

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;

        for index in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(index) else {
                continue;
            };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = control2.GetProcessId() else {
                continue;
            };
            if !tree.contains(&pid) {
                continue;
            }

            // Already ours: leave it alone so this stays cheap on every poll.
            if let Ok(current) = control2.GetDisplayName() {
                if current.to_string().unwrap_or_default() == display_name {
                    continue;
                }
            }

            let _ = control2.SetDisplayName(&HSTRING::from(display_name), std::ptr::null());
            let _ = control2.SetIconPath(&HSTRING::from(icon_path), std::ptr::null());
            renamed += 1;
        }
    }

    Ok(renamed)
}

/// Applies the label, initialising COM for the calling thread.
pub fn apply() -> usize {
    let icon = std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();

    unsafe {
        // The watcher thread has no apartment of its own yet.
        let initialised = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = label_sessions("Nemora", &icon).unwrap_or(0);
        if initialised {
            CoUninitialize();
        }
        result
    }
}
