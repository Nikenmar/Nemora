//! Windows' media controls (the media keys, the volume flyout, "now playing" on the lock screen):
//! the webview offered them only while it played audio itself, and now Nemora's own engine does,
//! so they are driven here. Their buttons arrive as the taskbar buttons' events, which the view
//! already handles.

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::commands::Res;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    album: String,
    /// The cover's `nemora` URL or path; empty for none.
    artwork: String,
    duration: f64,
    position: f64,
    playing: bool,
}

#[cfg(windows)]
mod platform {
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs, SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
    use windows::core::{HSTRING, factory};

    use super::NowPlaying;

    thread_local! {
        /// Lives on the main thread, where the window that owns it lives.
        static CONTROLS: RefCell<Option<SystemMediaTransportControls>> = const { RefCell::new(None) };
        static LAST_COVER: RefCell<String> = const { RefCell::new(String::new()) };
    }

    fn span(seconds: f64) -> TimeSpan {
        TimeSpan { Duration: (seconds.max(0.0) * 10_000_000.0) as i64 }
    }

    fn controls(handle: &AppHandle) -> windows::core::Result<SystemMediaTransportControls> {
        if let Some(existing) = CONTROLS.with(|c| c.borrow().clone()) {
            return Ok(existing);
        }
        let window = handle
            .get_webview_window("main")
            .ok_or_else(|| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))?;
        let hwnd = window.hwnd().map_err(|_| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))?;
        let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
        // SAFETY: `hwnd` is the live main window; the interop returns the controls bound to it.
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
        controls.SetIsEnabled(true)?;
        controls.SetIsPlayEnabled(true)?;
        controls.SetIsPauseEnabled(true)?;
        controls.SetIsNextEnabled(true)?;
        controls.SetIsPreviousEnabled(true)?;
        let events = handle.clone();
        controls.ButtonPressed(&TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                let event = match args.Button()? {
                    SystemMediaTransportControlsButton::Play | SystemMediaTransportControlsButton::Pause => {
                        "nemora://taskbar/play-pause"
                    }
                    SystemMediaTransportControlsButton::Next => "nemora://taskbar/next",
                    SystemMediaTransportControlsButton::Previous => "nemora://taskbar/previous",
                    _ => return Ok(()),
                };
                let _ = events.emit(event, ());
            }
            Ok(())
        }))?;
        CONTROLS.with(|c| *c.borrow_mut() = Some(controls.clone()));
        Ok(controls)
    }

    /// SMTC wants a picture it can open: the cover thumbnail, re-encoded as PNG once per cover.
    fn cover_file(profile: &Path, artwork: &str) -> Option<PathBuf> {
        if artwork.is_empty() || !artwork.starts_with("http://nemora.localhost/") {
            return None;
        }
        let local = crate::protocol::local_path_from_asset_url(artwork)?;
        let target = profile.join("now-playing-cover.png");
        let unchanged = LAST_COVER.with(|l| *l.borrow() == local) && target.exists();
        if !unchanged {
            image::open(&local).ok()?.save_with_format(&target, image::ImageFormat::Png).ok()?;
            LAST_COVER.with(|l| *l.borrow_mut() = local);
        }
        Some(target)
    }

    pub fn update(handle: &AppHandle, profile: &Path, now: &NowPlaying) -> windows::core::Result<()> {
        let controls = controls(handle)?;
        let display = controls.DisplayUpdater()?;
        display.SetType(MediaPlaybackType::Music)?;
        let music = display.MusicProperties()?;
        music.SetTitle(&HSTRING::from(&now.title))?;
        music.SetArtist(&HSTRING::from(&now.artist))?;
        music.SetAlbumTitle(&HSTRING::from(&now.album))?;
        match cover_file(profile, &now.artwork) {
            Some(path) => {
                let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
                display.SetThumbnail(&RandomAccessStreamReference::CreateFromFile(&file)?)?;
            }
            None => display.SetThumbnail(None::<&RandomAccessStreamReference>)?,
        }
        display.Update()?;
        let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
        timeline.SetStartTime(span(0.0))?;
        timeline.SetMinSeekTime(span(0.0))?;
        timeline.SetEndTime(span(now.duration))?;
        timeline.SetMaxSeekTime(span(now.duration))?;
        timeline.SetPosition(span(now.position))?;
        controls.UpdateTimelineProperties(&timeline)?;
        controls.SetPlaybackStatus(if now.playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        })?;
        Ok(())
    }

    pub fn clear() {
        CONTROLS.with(|c| {
            if let Some(controls) = c.borrow().as_ref() {
                let _ = controls.SetPlaybackStatus(MediaPlaybackStatus::Closed);
                if let Ok(display) = controls.DisplayUpdater() {
                    let _ = display.ClearAll();
                    let _ = display.Update();
                }
            }
        });
    }
}

/// What Windows shows as now playing; `None` clears it.
#[tauri::command]
pub fn smtc_update(handle: AppHandle, now: Option<NowPlaying>) -> Res<()> {
    let profile = handle.state::<crate::app::App>().profile.clone();
    let main = handle.clone();
    handle
        .run_on_main_thread(move || {
            #[cfg(windows)]
            match &now {
                Some(now) => {
                    if let Err(error) = platform::update(&main, &profile, now) {
                        eprintln!("[nemora] media controls: {error}");
                    }
                }
                None => platform::clear(),
            }
            #[cfg(not(windows))]
            let _ = (&main, &profile, &now);
        })
        .map_err(|e| e.to_string())
}
