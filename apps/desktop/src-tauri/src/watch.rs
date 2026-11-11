//! Watching the music folders while the app runs: a file added, changed, moved or deleted there is
//! picked up by a rescan once the folder has been quiet for a moment, so copying an album in shows
//! it without the manual resync.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Manager};

use crate::app::App;

/// How long the folders must stay quiet before the rescan: copying a large album writes for a while.
/// A rescan of an unchanged 1 779-song library takes about 3 ms, so the wait is all there is; a
/// second is enough for a copy to settle, and a file still being written is read again later.
const QUIET: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct FolderWatch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Mutex<Vec<PathBuf>>,
}

/// A path the library cares about: an audio file, or anything without an extension (a folder that
/// was moved or deleted as a whole).
fn relevant(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => nemora_core::scan::SUPPORTED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()),
        None => true,
    }
}

fn matters(event: &Event) -> bool {
    matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_))
        && event.paths.iter().any(|p| relevant(p))
}

/// What a rescan tells the view. The song lists listen for `songs/newSong` and `songs/deletedSong`
/// (the plain `songs` alone left an open Songs page as it was, so a file dropped into a folder
/// showed only once the page was opened again); artists, albums and genres for their own names.
fn changed_kinds(report: &nemora_core::scan::ScanReport) -> Vec<&'static str> {
    let mut kinds = vec!["songs", "artists", "albums", "genres", "userData/musicFolder"];
    if report.added + report.restored > 0 {
        kinds.extend(["songs/newSong", "genres/newGenre"]);
    }
    if report.missing > 0 {
        kinds.extend(["songs/deletedSong", "genres/deletedGenre"]);
    }
    if report.updated > 0 {
        kinds.push("songs/updatedSong");
    }
    kinds
}

/// Rescans after each burst of changes, once it has gone quiet.
fn debounce(handle: AppHandle, changes: Receiver<()>) {
    while changes.recv().is_ok() {
        while changes.recv_timeout(QUIET).is_ok() {}
        let app = handle.state::<App>();
        match app.scan() {
            Ok(report) if report.added + report.updated + report.restored + report.missing > 0 => {
                crate::commands::notify(&handle, &changed_kinds(&report));
            }
            Ok(_) => {}
            Err(error) => eprintln!("[nemora] rescan after a folder change failed: {error}"),
        }
    }
}

/// Starts watching; [`sync`] then follows the music folders as they are added and removed.
pub fn start(handle: &AppHandle) -> notify::Result<()> {
    let (tx, rx): (Sender<()>, Receiver<()>) = channel();
    let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if result.is_ok_and(|event| matters(&event)) {
            let _ = tx.send(());
        }
    })?;
    let debounced = handle.clone();
    std::thread::spawn(move || debounce(debounced, rx));
    *handle.state::<FolderWatch>().watcher.lock().unwrap_or_else(|e| e.into_inner()) = Some(watcher);
    sync(handle);
    Ok(())
}

/// Watches exactly the current music folders.
pub fn sync(handle: &AppHandle) {
    let roots: Vec<PathBuf> = match nemora_core::settings::music_folders(&handle.state::<App>().read()) {
        Ok(folders) => folders.into_iter().map(|f| f.path).collect(),
        Err(error) => {
            eprintln!("[nemora] music folders could not be read for watching: {error}");
            return;
        }
    };
    let state = handle.state::<FolderWatch>();
    let mut guard = state.watcher.lock().unwrap_or_else(|e| e.into_inner());
    let Some(watcher) = guard.as_mut() else { return };
    let mut watched = state.watched.lock().unwrap_or_else(|e| e.into_inner());
    for gone in watched.iter().filter(|w| !roots.contains(w)) {
        let _ = watcher.unwatch(gone);
    }
    for root in roots.iter().filter(|r| !watched.contains(r)) {
        if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
            eprintln!("[nemora] {} cannot be watched: {error}", root.display());
        }
    }
    *watched = roots;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_tells_the_song_lists() {
        let added = nemora_core::scan::ScanReport { added: 1, ..Default::default() };
        let kinds = changed_kinds(&added);
        assert!(kinds.contains(&"songs/newSong"), "{kinds:?}");
        assert!(!kinds.contains(&"songs/deletedSong"), "{kinds:?}");
        let gone = nemora_core::scan::ScanReport { missing: 2, ..Default::default() };
        assert!(changed_kinds(&gone).contains(&"songs/deletedSong"));
    }

    #[test]
    fn only_audio_files_and_folders_matter() {
        assert!(relevant(Path::new(r"E:\Music\a.FLAC")));
        assert!(relevant(Path::new(r"E:\Music\Album")));
        assert!(!relevant(Path::new(r"E:\Music\cover.jpg")));
        assert!(!relevant(Path::new(r"E:\Music\a.flac.lrc")));
    }
}
