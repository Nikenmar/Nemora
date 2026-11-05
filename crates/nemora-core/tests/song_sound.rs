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

fn audio_after_tag(bytes: &[u8]) -> &[u8] {
    let size = bytes[6..10].iter().fold(0usize, |value, byte| (value << 7) | *byte as usize);
    &bytes[10 + size..]
}

fn synchsafe(value: usize) -> [u8; 4] {
    [(value >> 21) as u8 & 0x7F, (value >> 14) as u8 & 0x7F, (value >> 7) as u8 & 0x7F, value as u8 & 0x7F]
}

fn id3_frame(major: u8, id: &str, body: &[u8]) -> Vec<u8> {
    let mut frame = id.as_bytes().to_vec();
    frame.extend_from_slice(&if major == 3 { (body.len() as u32).to_be_bytes() } else { synchsafe(body.len()) });
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(body);
    frame
}

/// An MP3 with a tag of exactly these frames and this padding, ahead of ffmpeg's untagged audio.
fn mp3_with_tag(root: &Path, name: &str, major: u8, frames: &[Vec<u8>], padding: usize) -> std::path::PathBuf {
    let bare = root.join(format!("{name}-bare.mp3"));
    let flac = root.join(format!("{name}-src.flac"));
    common::flac(&flac, 31, 2);
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&flac)
        .args(["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", "-write_xing", "0"])
        .arg(&bare)
        .status()
        .expect("ffmpeg runs");
    assert!(status.success());
    let body: Vec<u8> = frames.concat();
    let mut file = vec![b'I', b'D', b'3', major, 0, 0];
    file.extend_from_slice(&synchsafe(body.len() + padding));
    file.extend_from_slice(&body);
    file.resize(file.len() + padding, 0);
    file.extend_from_slice(&std::fs::read(&bare).unwrap());
    let path = root.join(format!("{name}.mp3"));
    std::fs::write(&path, file).unwrap();
    path
}

/// What lofty changes when it writes a tag again, all from a real library: a 2.3 tag's `TDRC` cut to
/// a year, an empty lyric frame dropped. Here every other frame stays the bytes it was; with padding
/// the audio does not move and taking the field out gives the very file back.
#[test]
fn an_mp3_keeps_every_other_frame_as_its_bytes() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound-frames");
    let text = encode(&SongSound { semitones: -2.0, keep_pitch: false, reverb: 0.0, size: "hall".into() });
    for major in [3u8, 4] {
        let utf16_date: Vec<u8> = [1u8, 0xFF, 0xFE]
            .into_iter()
            .chain("2024-09-12".encode_utf16().flat_map(u16::to_le_bytes))
            .chain([0, 0])
            .collect();
        // Longer than 127 bytes: the two versions spell a frame's size differently.
        let notes = [b"\0eng\0".as_slice(), "a long note ".repeat(30).as_bytes()].concat();
        let frames = vec![
            id3_frame(major, "TIT2", b"\0Song"),
            id3_frame(major, "TDRC", &utf16_date),
            id3_frame(major, "USLT", b"\x03eng\x00desc\x00"),
            id3_frame(major, "COMM", &notes),
        ];
        let path = mp3_with_tag(&root, &format!("v{major}"), major, &frames, 500);
        let original = std::fs::read(&path).unwrap();
        let id = identify_path(&path).unwrap();

        assert!(write_field(&path, Some(&text)).unwrap());
        assert_eq!(read_field(&path).unwrap().as_deref(), Some(text.as_str()), "v2.{major}: reads back");
        let written = std::fs::read(&path).unwrap();
        assert_eq!(written.len(), original.len(), "v2.{major}: padding paid for it, the audio did not move");
        assert_eq!(written[3], major, "the version stays");
        let all_frames = frames.concat();
        assert_eq!(&written[10..10 + all_frames.len()], &all_frames[..], "v2.{major}: the frames are the same bytes");
        assert_eq!(identify_path(&path).unwrap(), id);

        assert!(write_field(&path, None).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), original, "v2.{major}: out again, the very file");

        // No padding: the tag grows, the audio behind it is the same bytes.
        let tight = mp3_with_tag(&root, &format!("t{major}"), major, &frames, 0);
        let before = std::fs::read(&tight).unwrap();
        assert!(write_field(&tight, Some(&text)).unwrap());
        let after = std::fs::read(&tight).unwrap();
        assert_eq!(&after[10..10 + all_frames.len()], &all_frames[..]);
        assert_eq!(audio_after_tag(&after), audio_after_tag(&before), "v2.{major}: the audio as it was");
        assert_eq!(read_field(&tight).unwrap().as_deref(), Some(text.as_str()));

        // A field an earlier build left in UTF-16 is replaced, not doubled.
        let old: Vec<u8> = [1u8, 0xFF, 0xFE]
            .into_iter()
            .chain("NEMORA_SOUND".encode_utf16().flat_map(u16::to_le_bytes))
            .chain([0, 0, 0xFF, 0xFE])
            .chain("v1;semitones=5".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        let earlier =
            mp3_with_tag(&root, &format!("e{major}"), major, &[frames[0].clone(), id3_frame(major, "TXXX", &old)], 200);
        assert_eq!(read_field(&earlier).unwrap().as_deref(), Some("v1;semitones=5"), "the earlier field is read");
        assert!(write_field(&earlier, Some(&text)).unwrap());
        assert_eq!(read_field(&earlier).unwrap().as_deref(), Some(text.as_str()));
        let bytes = std::fs::read(&earlier).unwrap();
        assert_eq!(bytes.windows(4).filter(|window| *window == b"TXXX").count(), 1, "one field");
    }
    // A file with no tag at all is not this module's: it still takes the field.
    let flac = root.join("none-src.flac");
    common::flac(&flac, 33, 2);
    let none = root.join("none.mp3");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&flac)
        .args(["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", "-write_xing", "0"])
        .arg(&none)
        .status()
        .unwrap();
    assert!(status.success());
    assert!(write_field(&none, Some(&text)).unwrap());
    assert_eq!(read_field(&none).unwrap().as_deref(), Some(text.as_str()));
    let _ = std::fs::remove_dir_all(&root);
}

/// The FLAC's blocks with its padding dropped.
fn without_padding(path: &Path) {
    let bytes = std::fs::read(path).unwrap();
    let mut out = b"fLaC".to_vec();
    let mut at = 4;
    let mut blocks = Vec::new();
    loop {
        let len = u32::from_be_bytes([0, bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize;
        let last = bytes[at] & 0x80 != 0;
        if bytes[at] & 0x7F != 1 {
            blocks.push((bytes[at] & 0x7F, &bytes[at + 1..at + 4 + len]));
        }
        at += 4 + len;
        if last {
            break;
        }
    }
    let count = blocks.len();
    for (index, (kind, rest)) in blocks.into_iter().enumerate() {
        out.push(if index + 1 == count { kind | 0x80 } else { kind });
        out.extend_from_slice(rest);
    }
    out.extend_from_slice(&bytes[at..]);
    std::fs::write(path, out).unwrap();
}

/// What lofty changes in a FLAC, seen on a real library: `tracknumber=4/7` split in two, names put
/// in capitals. Here they stay, the picture stays, and a read-only file is refused however the
/// field would have fitted.
#[test]
fn a_flac_keeps_every_other_comment_as_its_bytes() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("song-sound-comments");
    let source = root.join("src.flac");
    common::flac(&source, 41, 2);
    let path = root.join("a.flac");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&source)
        .args(["-c:a", "flac", "-metadata", "tracknumber=4/7", "-metadata", "discnumber=1", "-metadata", "MiXeD=Case"])
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    common::set_tags(&path, "Song", "Someone", None, Some(common::png(5)));
    // lofty has been at it above: the comments as the test wants them, written last by hand.
    let raw = |bytes: &[u8], needle: &[u8]| bytes.windows(needle.len()).any(|window| window == needle);
    let path2 = root.join("b.flac");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&source)
        .args(["-c:a", "flac", "-metadata", "tracknumber=4/7", "-metadata", "discnumber=1", "-metadata", "MiXeD=Case"])
        .arg(&path2)
        .status()
        .unwrap();
    assert!(status.success());
    let original = std::fs::read(&path2).unwrap();
    assert!(raw(&original, b"tracknumber=4/7"), "ffmpeg kept the spelling");
    let id = identify_path(&path2).unwrap();
    let text = encode(&SongSound { semitones: -2.0, keep_pitch: false, reverb: 0.0, size: "hall".into() });

    assert!(write_field(&path2, Some(&text)).unwrap());
    let written = std::fs::read(&path2).unwrap();
    assert!(raw(&written, b"tracknumber=4/7") && raw(&written, b"discnumber=1") && raw(&written, b"MiXeD=Case"));
    assert!(!raw(&written, b"TRACKTOTAL"), "not split");
    assert_eq!(written.len(), original.len(), "padding paid for it");
    assert_eq!(identify_path(&path2).unwrap(), id);
    assert!(write_field(&path2, None).unwrap());
    assert_eq!(std::fs::read(&path2).unwrap(), original, "out again, the very file");

    // With a picture block and no padding: the file grows, the picture and the audio are the same.
    let cover = read_tags(&path).unwrap().cover.expect("the cover was set").data;
    without_padding(&path);
    let id = identify_path(&path).unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(write_field(&path, Some(&text)).unwrap());
    assert!(std::fs::read(&path).unwrap().len() > before.len());
    assert_eq!(read_field(&path).unwrap().as_deref(), Some(text.as_str()));
    assert_eq!(read_tags(&path).unwrap().cover.map(|c| c.data).as_ref(), Some(&cover));
    assert_eq!(identify_path(&path).unwrap(), id);

    // Read-only, where the copy would be made through a second file: refused all the same.
    assert!(write_field(&path, None).unwrap());
    without_padding(&path);
    let before = std::fs::read(&path).unwrap();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions.clone()).unwrap();
    assert!(write_field(&path, Some(&text)).is_err(), "a read-only file is refused");
    assert_eq!(std::fs::read(&path).unwrap(), before);
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&path, permissions).unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".nemora-tmp"))
        .collect();
    assert!(leftovers.is_empty(), "no copy left: {leftovers:?}");
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
