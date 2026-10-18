//! Development probe for `nemora-audio-v1`.
//!
//!   identity_probe scan <folder> [limit]   ids, formats and timing for audio files under a folder
//!   identity_probe check <file>...         copy each file to a temp dir, retag it and add a cover,
//!                                          and confirm the id did not move (the original is never
//!                                          touched)
//!   identity_probe raw <file>...           the demuxer's own frame count next to the id
//!
//! Never writes to the given paths.

use std::path::{Path, PathBuf};
use std::time::Instant;

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::Tag;
use nemora_core::identity::identify_path;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

const AUDIO: &[&str] = &["mp3", "flac", "m4a", "aac", "m4r", "ogg", "opus", "wav"];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("scan") => scan(Path::new(&args[1]), args.get(2).and_then(|n| n.parse().ok()).unwrap_or(usize::MAX)),
        Some("check") => args[1..].iter().for_each(|p| check(Path::new(p))),
        Some("raw") => args[1..].iter().for_each(|p| raw(Path::new(p))),
        _ => eprintln!("usage: identity_probe scan <folder> [limit] | check <file>... | raw <file>..."),
    }
}

fn audio_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            audio_files(&path, out);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| AUDIO.contains(&e.to_ascii_lowercase().as_str()))
        {
            out.push(path);
        }
    }
}

fn scan(dir: &Path, limit: usize) {
    let mut files = Vec::new();
    audio_files(dir, &mut files);
    files.sort();
    files.truncate(limit);
    let started = Instant::now();
    let (mut ok, mut failed, mut bytes) = (0usize, 0usize, 0u64);
    let mut by_format = std::collections::BTreeMap::<String, usize>::new();
    let mut ids = std::collections::HashMap::new();
    for file in &files {
        match identify_path(file) {
            Ok(identity) => {
                ok += 1;
                bytes += identity.bytes_hashed;
                *by_format.entry(format!("{}/{}", identity.format, identity.codec)).or_default() += 1;
                if let Some(previous) = ids.insert(identity.song_id, file.clone()) {
                    println!("same id: {} and {}", previous.display(), file.display());
                }
            }
            Err(e) => {
                failed += 1;
                println!("FAILED {}: {e}", file.display());
            }
        }
    }
    let elapsed = started.elapsed();
    println!(
        "{ok} identified, {failed} failed, {} distinct ids, {:.1} MB hashed in {:.2?} ({:.2} ms per file)",
        ids.len(),
        bytes as f64 / 1e6,
        elapsed,
        elapsed.as_secs_f64() * 1000.0 / files.len().max(1) as f64
    );
    for (format, count) in by_format {
        println!("  {format}: {count}");
    }
}

fn check(file: &Path) {
    let before = identify_path(file).expect("identify original");
    let dir = std::env::temp_dir().join(format!("nemora-identity-check-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let copy = dir.join(format!("copy.{}", file.extension().unwrap().to_string_lossy()));
    std::fs::copy(file, &copy).unwrap();

    let mut tagged = lofty::read_from_path(&copy).unwrap();
    if tagged.primary_tag_mut().is_none() {
        let tag_type = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged.primary_tag_mut().unwrap();
    tag.set_title("Retagged by identity_probe".to_owned());
    tag.set_artist("Nobody".to_owned());
    tag.push_picture(
        Picture::unchecked(vec![0x5a; 300_000]).pic_type(PictureType::CoverFront).mime_type(MimeType::Jpeg).build(),
    );
    tagged.save_to_path(&copy, WriteOptions::default()).unwrap();

    let after = identify_path(&copy).expect("identify copy");
    let changed_on_disk = std::fs::read(file).unwrap() != std::fs::read(&copy).unwrap();
    println!(
        "{} {} -> {} ({}, file changed: {changed_on_disk})",
        if before.song_id == after.song_id { "SAME" } else { "MOVED" },
        before.song_id,
        after.song_id,
        file.display()
    );
    let _ = std::fs::remove_dir_all(&dir);
}

fn raw(file: &Path) {
    let identity = identify_path(file).expect("identify");
    let stream = MediaSourceStream::new(Box::new(std::fs::File::open(file).unwrap()), Default::default());
    let reader = symphonia::default::get_probe()
        .probe(&Hint::new(), stream, FormatOptions::default(), MetadataOptions::default())
        .unwrap();
    let track = reader.default_track(TrackType::Audio).unwrap();
    println!(
        "{} format={} demuxer frames={:?} hashed frames={:?} ({})",
        identity.song_id,
        identity.format,
        track.num_frames,
        identity.frame_count,
        file.display()
    );
}
