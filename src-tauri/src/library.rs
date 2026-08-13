//! Walking the music folders and reading what is in them.
//!
//! The split here is deliberate and is the rule the whole Rust migration
//! follows: **move what has a byte interface, keep what has an
//! application-semantics interface.** Rust walks the directories and parses the
//! files, because both are "bytes in, facts out". It does NOT build folder
//! structures, decide which paths are new, batch them, or write the catalog -
//! that is application behaviour, it lives in TypeScript, and `nora-android`
//! reuses it.
//!
//! What this replaces, per file: one `stat` and one 256 KB `readHead` through
//! the plugin-fs bridge, then a parse in a web worker. The head limit existed
//! because reading whole files through that bridge was measured at 115 ms per
//! file; here the file is opened where it lives and only what the parser asks
//! for is read.
//!
//! ONE THING DELIBERATELY DOES NOT CROSS: embedded picture bytes. `parse`
//! reports that a picture exists, its MIME type and its size, and stops there.
//! The cover is produced by `artwork_transform_audio`, which opens the same
//! file itself. Sending a 3 MB picture into the renderer so it can send it back
//! is exactly the round trip this module exists to remove.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::MimeType;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use serde::Serialize;

/// One visited directory, flat rather than nested.
///
/// The tree is reassembled on the TypeScript side, which already knows what a
/// `FolderStructure` is - including how song counts roll up and how overlapping
/// selected roots are de-duplicated. Returning a flat list keeps that knowledge
/// in one place instead of splitting it across two languages.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkedDirectory {
    pub path: String,
    /// Epoch milliseconds, or null when the platform does not report it.
    pub modified: Option<f64>,
    pub created: Option<f64>,
    /// Immediate subdirectories, full paths. Symlinks are excluded.
    pub directories: Vec<String>,
    /// Immediate music files, full paths, filtered by the caller's extensions.
    pub files: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCommon {
    pub title: Option<String>,
    /// Left exactly as the tag stores it, including a multi-artist string.
    /// Splitting it is the caller's job and it already has rules for that.
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genres: Vec<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedFormat {
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bitrate: Option<u32>,
    pub number_of_channels: Option<u32>,
    pub container: Option<String>,
    pub lossless: Option<bool>,
}

/// A picture WITHOUT its bytes. See the module note.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPicture {
    pub format: String,
    pub byte_length: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedFile {
    pub path: String,
    pub size: u64,
    pub created_date: Option<f64>,
    pub modified_date: Option<f64>,
    pub common: ParsedCommon,
    pub format: ParsedFormat,
    pub pictures: Vec<ParsedPicture>,
    /// Set instead of the rest when this one file could not be read. A scan
    /// must not fail because a single file is locked or malformed, so failures
    /// travel WITH the batch rather than rejecting it.
    pub error: Option<String>,
}

fn epoch_millis(time: std::io::Result<SystemTime>) -> Option<f64> {
    time.ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as f64)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()))
        .unwrap_or_default()
}

/// Depth-first walk that never follows a symlink.
///
/// Symlinks are skipped for the same reason the TypeScript walk skips them: a
/// link pointing at an ancestor turns a library scan into an infinite one. The
/// visited set covers the remaining way to arrive twice, which is two selected
/// roots overlapping.
fn walk_impl(roots: Vec<String>, extensions: Vec<String>) -> Vec<WalkedDirectory> {
    let allowed: HashSet<String> = extensions
        .into_iter()
        .map(|value| value.to_lowercase())
        .collect();
    let mut visited: HashSet<String> = HashSet::new();
    let mut result: Vec<WalkedDirectory> = Vec::new();
    let mut queue: Vec<PathBuf> = Vec::new();

    for root in roots {
        let path = PathBuf::from(&root);
        if visited.insert(canonical_key(&path)) {
            queue.push(path);
        }
    }

    while let Some(directory) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            // An unreadable directory is reported by omission, not by failing
            // the walk: one folder the user cannot read must not cost them the
            // whole scan.
            continue;
        };

        let metadata = std::fs::metadata(&directory).ok();
        let mut directories = Vec::new();
        let mut files = Vec::new();

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let key = canonical_key(&path);
                directories.push(path.to_string_lossy().to_string());
                if visited.insert(key) {
                    queue.push(path);
                }
            } else if file_type.is_file() && allowed.contains(&extension_of(&path)) {
                files.push(path.to_string_lossy().to_string());
            }
        }

        // Order is not guaranteed by the file system and the caller sorts what
        // it shows, but a stable walk makes a scan reproducible and its logs
        // comparable between runs.
        directories.sort();
        files.sort();

        result.push(WalkedDirectory {
            path: directory.to_string_lossy().to_string(),
            modified: metadata
                .as_ref()
                .and_then(|value| epoch_millis(value.modified())),
            created: metadata
                .as_ref()
                .and_then(|value| epoch_millis(value.created())),
            directories,
            files,
        });
    }

    result
}

fn canonical_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase().replace('/', "\\")
}

fn parse_one(path: &str) -> ParsedFile {
    let mut parsed = ParsedFile {
        path: path.to_string(),
        size: 0,
        created_date: None,
        modified_date: None,
        common: ParsedCommon::default(),
        format: ParsedFormat::default(),
        pictures: Vec::new(),
        error: None,
    };

    match std::fs::metadata(path) {
        Ok(metadata) => {
            parsed.size = metadata.len();
            parsed.created_date = epoch_millis(metadata.created());
            parsed.modified_date = epoch_millis(metadata.modified());
        }
        Err(error) => {
            parsed.error = Some(format!("cannot stat {path}: {error}"));
            return parsed;
        }
    }

    // Relaxed parsing: a tag that is slightly out of spec is extremely common
    // in a real library, and refusing such a file would lose a song over a
    // detail no listener can hear.
    let probe = match Probe::open(Path::new(path)) {
        Ok(probe) => probe.options(
            ParseOptions::new()
                .read_properties(true)
                .parsing_mode(ParsingMode::Relaxed),
        ),
        Err(error) => {
            parsed.error = Some(format!("cannot open {path}: {error}"));
            return parsed;
        }
    };

    let tagged = match probe.read() {
        Ok(value) => value,
        Err(error) => {
            parsed.error = Some(format!("cannot read {path}: {error}"));
            return parsed;
        }
    };

    let properties = tagged.properties();
    parsed.format = ParsedFormat {
        duration: Some(properties.duration().as_secs_f64()).filter(|value| *value > 0.0),
        sample_rate: properties.sample_rate(),
        bitrate: properties.audio_bitrate().map(|value| value * 1000),
        number_of_channels: properties.channels().map(u32::from),
        container: Some(format!("{:?}", tagged.file_type())),
        lossless: None,
    };

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return parsed;
    };

    parsed.common = ParsedCommon {
        title: tag.title().map(|value| value.to_string()),
        artist: tag.artist().map(|value| value.to_string()),
        album_artist: tag
            .get_string(ItemKey::AlbumArtist)
            .map(|value| value.to_string()),
        album: tag.album().map(|value| value.to_string()),
        // The caller expects a list here and splits nothing itself, so the
        // separators taggers actually use are applied on this side.
        genres: tag
            .genre()
            .map(|value| {
                value
                    .split(&[',', ';', '/'][..])
                    .map(|part| part.trim().to_string())
                    .filter(|part| !part.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        // Stored as text even when it holds a full date, so the leading four
        // digits are the year and the rest is a recording date nobody displays.
        year: tag
            .get_string(ItemKey::Year)
            .or_else(|| tag.get_string(ItemKey::RecordingDate))
            .and_then(|value| value.get(..4).and_then(|year| year.parse::<u32>().ok())),
        track_number: tag.track(),
        disc_number: tag.disk(),
    };

    parsed.pictures = tag
        .pictures()
        .iter()
        .filter(|picture| !picture.data().is_empty())
        .map(|picture| ParsedPicture {
            format: picture
                .mime_type()
                .map(MimeType::to_string)
                .unwrap_or_default(),
            byte_length: picture.data().len() as u64,
        })
        .collect();

    parsed
}

/// Parses a batch across threads, preserving the order it was given.
///
/// Order matters because the caller pairs the answers back with the paths it
/// sent, and a batch is how the cost of crossing the bridge is amortised: one
/// call for a hundred files instead of two calls per file.
fn parse_batch(paths: Vec<String>) -> Vec<ParsedFile> {
    let workers = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .clamp(1, 8)
        .min(paths.len().max(1));

    if workers <= 1 || paths.len() <= 1 {
        return paths.iter().map(|path| parse_one(path)).collect();
    }

    let mut slots: Vec<Option<ParsedFile>> = (0..paths.len()).map(|_| None).collect();
    let chunk = paths.len().div_ceil(workers);

    std::thread::scope(|scope| {
        for (chunk_paths, chunk_slots) in paths.chunks(chunk).zip(slots.chunks_mut(chunk)) {
            scope.spawn(move || {
                for (path, slot) in chunk_paths.iter().zip(chunk_slots.iter_mut()) {
                    *slot = Some(parse_one(path));
                }
            });
        }
    });

    slots.into_iter().flatten().collect()
}

#[tauri::command]
pub async fn library_walk(
    roots: Vec<String>,
    extensions: Vec<String>,
) -> Result<Vec<WalkedDirectory>, String> {
    tauri::async_runtime::spawn_blocking(move || walk_impl(roots, extensions))
        .await
        .map_err(|error| format!("library walk task failed: {error}"))
}

#[tauri::command]
pub async fn library_parse(paths: Vec<String>) -> Result<Vec<ParsedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || parse_batch(paths))
        .await
        .map_err(|error| format!("library parse task failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("the fixture directory is writable");
        path
    }

    #[test]
    fn walks_nested_directories_and_keeps_only_supported_files() {
        let root = temp_dir("nemora-walk-fixture");
        let nested = root.join("album");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("a.mp3"), b"x").unwrap();
        std::fs::write(root.join("cover.jpg"), b"x").unwrap();
        std::fs::write(nested.join("b.FLAC"), b"x").unwrap();

        let walked = walk_impl(
            vec![root.to_string_lossy().to_string()],
            vec![".mp3".into(), ".flac".into()],
        );

        assert_eq!(walked.len(), 2, "the root and its one subdirectory");
        let root_entry = walked
            .iter()
            .find(|entry| entry.path == root.to_string_lossy())
            .expect("the root is reported");
        assert_eq!(root_entry.files.len(), 1, "cover.jpg is not music");
        assert!(root_entry.files[0].ends_with("a.mp3"));
        assert_eq!(root_entry.directories.len(), 1);

        let nested_entry = walked
            .iter()
            .find(|entry| entry.path == nested.to_string_lossy())
            .expect("the subdirectory is reported");
        // Extension matching is case-insensitive, as it is in the TypeScript walk.
        assert_eq!(nested_entry.files.len(), 1);
        assert!(nested_entry.files[0].ends_with("b.FLAC"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn overlapping_roots_visit_a_directory_once() {
        let root = temp_dir("nemora-walk-overlap");
        std::fs::create_dir_all(root.join("inner")).unwrap();

        let walked = walk_impl(
            vec![
                root.to_string_lossy().to_string(),
                root.join("inner").to_string_lossy().to_string(),
            ],
            vec![".mp3".into()],
        );

        assert_eq!(walked.len(), 2, "inner is reachable twice but walked once");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_batch_reports_a_broken_file_without_losing_the_rest() {
        let root = temp_dir("nemora-parse-batch");
        let broken = root.join("broken.mp3");
        std::fs::write(&broken, b"not audio at all").unwrap();
        let missing = root.join("gone.mp3");

        let parsed = parse_batch(vec![
            broken.to_string_lossy().to_string(),
            missing.to_string_lossy().to_string(),
        ]);

        assert_eq!(parsed.len(), 2, "order and length are preserved");
        assert_eq!(parsed[0].path, broken.to_string_lossy());
        assert!(
            parsed[1].error.is_some(),
            "a missing file reports its error"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Parses a real track from the library when one is reachable.
    ///
    /// Skipped, never failed, on a machine without that profile.
    #[test]
    fn parses_a_real_track_without_returning_picture_bytes() {
        let Ok(appdata) = std::env::var("APPDATA") else {
            return;
        };
        let songs = Path::new(&appdata).join("Nora").join("songs.json");
        let Ok(raw) = std::fs::read_to_string(&songs) else {
            return;
        };
        let Some(start) = raw.find("\"path\":\"") else {
            return;
        };
        let rest = &raw[start + 8..];
        let Some(end) = rest.find('"') else { return };
        let path = rest[..end].replace("\\\\", "\\");
        if !Path::new(&path).exists() {
            return;
        }

        let parsed = parse_one(&path);
        assert!(parsed.error.is_none(), "{:?}", parsed.error);
        assert!(parsed.size > 0);
        assert!(parsed.format.duration.unwrap_or(0.0) > 0.0);
    }
}
