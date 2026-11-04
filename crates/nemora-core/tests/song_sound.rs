//! Switch version's sound in the file: only Nemora's field changes; every other tag, the user's
//! notes among them, and the song's id stay exactly as they were (real files made by ffmpeg).
mod common;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use nemora_core::identity::identify_path;
use nemora_core::song_sound::{SongSound, decode, encode, read_field, write_field};
use nemora_core::tags::read_tags;

/// Every tag ffprobe sees (container and stream), names lowercased.
fn all_tags(path: &Path) -> BTreeMap<String, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json"])
        .arg(path)
        .output()
        .expect("ffprobe runs");
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let mut tags = BTreeMap::new();
    let mut take = |value: &serde_json::Value| {
        if let Some(map) = value.get("tags").and_then(|t| t.as_object()) {
            for (k, v) in map {
                tags.insert(k.to_lowercase(), v.as_str().unwrap_or_default().to_owned());
            }
        }
    };
    take(&json["format"]);
    for stream in json["streams"].as_array().into_iter().flatten() {
        take(stream);
    }
    tags
}

/// Nemora's field as ffprobe names it: `nemora_sound` (ID3v2, Vorbis), `sound` (an MP4 freeform atom).
fn ours(key: &str) -> bool {
    key.contains("nemora") || key == "sound"
}

fn without_ours(mut tags: BTreeMap<String, String>) -> BTreeMap<String, String> {
    tags.retain(|k, _| !ours(k));
    tags
}

/// A file of `ext` from a FLAC, with a title, the user's notes and a field of someone else's.
fn make(root: &Path, ext: &str, codec: &[&str]) -> std::path::PathBuf {
    let flac = root.join(format!("src-{ext}.flac"));
    common::flac(&flac, 7, 2);
    let path = root.join(format!("a.{ext}"));
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&flac)
        .args(codec)
        .args(["-metadata", "title=Song", "-metadata", "comment=My own notes, keep them", "-metadata", "MOOD=calm"])
        .arg(&path)
        .status()
        .expect("ffmpeg runs");
    assert!(status.success(), "ffmpeg made {ext}");
    path
}

#[test]
fn the_field_goes_in_and_out_touching_nothing_else() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound");
    let sound = SongSound { semitones: -2.0, keep_pitch: false, reverb: 0.35, size: "hall".into() };
    let text = encode(&sound);
    for (ext, codec) in [
        ("mp3", &["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3"][..]),
        ("flac", &["-c:a", "flac"][..]),
        ("m4a", &["-c:a", "aac", "-b:a", "128k"][..]),
        ("opus", &["-c:a", "libopus", "-b:a", "64k"][..]),
    ] {
        let path = make(&root, ext, codec);
        // The front cover, which FLAC keeps outside its tag and the others inside it.
        common::set_tags(&path, "Song", "Someone", None, Some(common::png(5)));
        let tags = all_tags(&path);
        let id = identify_path(&path).unwrap();
        let cover = read_tags(&path).unwrap().cover.expect("the cover was set").data;
        assert_eq!(read_field(&path).unwrap(), None, "{ext}: no field yet");

        assert!(write_field(&path, Some(&text)).unwrap(), "{ext}: has a place for it");
        assert_eq!(read_field(&path).unwrap().as_deref(), Some(text.as_str()), "{ext}: written");
        assert_eq!(decode(&read_field(&path).unwrap().unwrap()), Some(sound.clone()));
        assert_eq!(without_ours(all_tags(&path)), tags, "{ext}: every other tag as it was");
        assert_eq!(read_tags(&path).unwrap().cover.map(|c| c.data).as_ref(), Some(&cover), "{ext}: the cover stays");
        assert_eq!(identify_path(&path).unwrap(), id, "{ext}: the song keeps its id");
        // Written again: still one field.
        let other = encode(&SongSound { semitones: 3.0, keep_pitch: true, reverb: 0.0, size: "room".into() });
        write_field(&path, Some(&other)).unwrap();
        assert_eq!(read_field(&path).unwrap().as_deref(), Some(other.as_str()), "{ext}: replaced");
        assert_eq!(all_tags(&path).keys().filter(|k| ours(k)).count(), 1, "{ext}: one field");

        assert!(write_field(&path, None).unwrap());
        assert_eq!(read_field(&path).unwrap(), None, "{ext}: removed");
        assert_eq!(all_tags(&path), tags, "{ext}: back to the tags it had");
        assert_eq!(
            read_tags(&path).unwrap().cover.map(|c| c.data).as_ref(),
            Some(&cover),
            "{ext}: the cover still stays"
        );
        assert_eq!(identify_path(&path).unwrap(), id, "{ext}: the song keeps its id");
        // Removing what is not there changes nothing.
        assert!(write_field(&path, None).unwrap());
        assert_eq!(all_tags(&path), tags);
    }
    // A file that cannot be replaced: the error is reported, the original stays, no copy is left.
    let locked = make(&root, "flac", &["-c:a", "flac"]);
    let bytes = std::fs::read(&locked).unwrap();
    let mut permissions = std::fs::metadata(&locked).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&locked, permissions.clone()).unwrap();
    assert!(write_field(&locked, Some(&text)).is_err(), "a read-only file is refused");
    assert_eq!(std::fs::read(&locked).unwrap(), bytes, "the original is untouched");
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&locked, permissions).unwrap();
    // Writing what the file already says changes nothing, and no copy stays behind.
    write_field(&locked, Some(&text)).unwrap();
    let written = std::fs::read(&locked).unwrap();
    write_field(&locked, Some(&text)).unwrap();
    assert_eq!(std::fs::read(&locked).unwrap(), written);
    let leftovers: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".nemora-tmp"))
        .collect();
    assert!(leftovers.is_empty(), "no copy left: {leftovers:?}");

    // A format with no place for it answers false and leaves the file alone.
    let wav = root.join("a.wav");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(root.join("src-flac.flac"))
        .arg(&wav)
        .status()
        .unwrap();
    assert!(status.success());
    let before = std::fs::read(&wav).unwrap();
    assert!(!write_field(&wav, Some(&text)).unwrap());
    assert_eq!(std::fs::read(&wav).unwrap(), before);
    let _ = std::fs::remove_dir_all(&root);
}

/// lofty writes ID3v2.4 unless told; a file that has 2.3 keeps it, and its picture.
#[test]
fn an_mp3_keeps_its_id3_version() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound-id3");
    let path = make(&root, "mp3", &["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3"]);
    assert_eq!(&std::fs::read(&path).unwrap()[..4], b"ID3\x03", "ffmpeg wrote 2.3");
    let tags = all_tags(&path);
    let text = encode(&SongSound { semitones: 2.0, keep_pitch: false, reverb: 0.0, size: "hall".into() });
    write_field(&path, Some(&text)).unwrap();
    assert_eq!(&std::fs::read(&path).unwrap()[..4], b"ID3\x03", "still 2.3");
    assert_eq!(without_ours(all_tags(&path)), tags);
    let _ = std::fs::remove_dir_all(&root);
}

/// The engine reads the song it plays through an open handle: the field can go in at once, and what
/// the handle reads does not move.
#[test]
fn a_file_open_for_playing_takes_the_field_and_keeps_playing_what_it_read() {
    use std::io::{Read, Seek, SeekFrom};

    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound-open");
    let path = root.join("a.flac");
    common::flac(&path, 9, 3);
    common::set_tags(&path, "Song", "Someone", None, Some(common::png(6)));
    let original = std::fs::read(&path).unwrap();
    let id = identify_path(&path).unwrap();

    let mut playing = std::fs::File::open(&path).unwrap();
    let mut head = vec![0; 1000];
    playing.read_exact(&mut head).unwrap();

    let text = encode(&SongSound { semitones: 2.0, keep_pitch: false, reverb: 0.0, size: "hall".into() });
    assert!(write_field(&path, Some(&text)).unwrap(), "written while it is open");
    assert_eq!(read_field(&path).unwrap().as_deref(), Some(text.as_str()));
    assert_eq!(identify_path(&path).unwrap(), id);

    // The open handle goes on reading the file as it was, to its end.
    playing.seek(SeekFrom::Start(0)).unwrap();
    let mut read = Vec::new();
    playing.read_to_end(&mut read).unwrap();
    assert_eq!(read, original, "what was being played did not move");
    drop(playing);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_scan_takes_the_sound_a_file_carries_and_files_finds_the_songs_file() {
    use nemora_core::covers::CoverStore;
    use nemora_core::db::Db;
    use nemora_core::scan::scan_folders;
    use nemora_core::song_sound::{all, files, set};

    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound-scan");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    let with = music.join("with.flac");
    let without = music.join("without.flac");
    common::flac(&with, 21, 2);
    common::flac(&without, 22, 2);
    let sound = SongSound { semitones: -4.0, keep_pitch: false, reverb: 0.5, size: "vast".into() };
    write_field(&with, Some(&encode(&sound))).unwrap();

    let mut db = Db::open(&root.join("nemora.db")).unwrap();
    let covers = CoverStore::new(root.join("covers"));
    scan_folders(&mut db, &covers, std::slice::from_ref(&music)).unwrap();

    let id = identify_path(&with).unwrap().song_id.to_string();
    assert_eq!(all(&db).unwrap(), vec![(id.clone(), sound.clone())], "the file's sound, and only that one");
    assert_eq!(files(&db, &id).unwrap().len(), 1);

    // A sound the library keeps for a song whose file has none survives a scan.
    let other = identify_path(&without).unwrap().song_id.to_string();
    let kept = SongSound { semitones: 2.0, keep_pitch: true, reverb: 0.0, size: "hall".into() };
    set(&db, &other, Some(&kept)).unwrap();
    scan_folders(&mut db, &covers, &[music]).unwrap();
    assert_eq!(all(&db).unwrap().len(), 2);
    set(&db, &other, None).unwrap();
    assert_eq!(all(&db).unwrap().len(), 1);
    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}
