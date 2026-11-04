mod common;

use nemora_core::identity::identify_path;
use nemora_core::tags::{TagEdit, read_details, read_tags, write_tags};

#[test]
fn an_edit_changes_the_tags_and_never_the_song() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("tags");
    let path = root.join("a.flac");
    common::flac(&path, 11, 3);
    common::set_tags(&path, "Old", "Someone", Some("Old album"), Some(common::png(3)));
    let before = identify_path(&path).unwrap();

    let cover = common::png(9);
    let edit = TagEdit {
        title: "New title".into(),
        artists: vec!["A".into(), "B".into()],
        album_artists: vec!["A".into()],
        album: None,
        genres: vec!["Jazz".into(), "Funk".into()],
        year: Some(2024),
        track_no: Some(7),
        composer: Some("C".into()),
        cover: Some(cover.clone()),
    };
    write_tags(&path, &edit).unwrap();

    let tags = read_tags(&path).unwrap();
    assert_eq!(tags.title, "New title");
    assert_eq!(tags.artists, ["A", "B"]);
    assert_eq!(tags.album_artists, ["A"]);
    assert_eq!(tags.album, None, "an emptied field is removed");
    assert_eq!(tags.genres, ["Jazz", "Funk"]);
    assert_eq!((tags.year, tags.track_no), (Some(2024), Some(7)));
    assert_eq!(tags.composer.as_deref(), Some("C"));
    assert_eq!(tags.cover.map(|c| c.data), Some(cover), "the new front cover replaces the old one");
    assert_eq!(identify_path(&path).unwrap(), before, "the audio and so the song id are untouched");

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_rendered_wav_gets_the_songs_tags_cover_and_its_versions_title() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("tags-copy");
    let song = root.join("a.flac");
    common::flac(&song, 5, 2);
    let cover = common::png(4);
    common::set_tags(&song, "Song", "Someone", Some("Album"), Some(cover.clone()));
    let wav = root.join("a (Slowed).wav");
    let status = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(&song)
        .args(["-map_metadata", "-1", "-c:a", "pcm_f32le"])
        .arg(&wav)
        .status()
        .unwrap();
    assert!(status.success());
    nemora_core::tags::copy_tags(&song, &wav, "Song (Slowed)").unwrap();
    let tags = read_tags(&wav).unwrap();
    assert_eq!(tags.title, "Song (Slowed)");
    assert_eq!(tags.artists, ["Someone"]);
    assert_eq!(tags.album.as_deref(), Some("Album"));
    assert_eq!(tags.cover.map(|c| c.data), Some(cover));
    let _ = std::fs::remove_dir_all(&root);
}

fn add_text(path: &std::path::Path, items: &[(lofty::tag::ItemKey, &str)]) {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::prelude::TagExt;

    let mut file = lofty::read_from_path(path).unwrap();
    let tag = file.primary_tag_mut().unwrap();
    for (key, value) in items {
        tag.insert_text(*key, (*value).to_owned());
    }
    tag.save_to_path(path, WriteOptions::default()).unwrap();
}

/// The song's page reads these from the file: FLAC's and MP3's own fields, a label standing in for a
/// publisher, and none of them for a file that has none.
#[test]
fn a_file_gives_its_page_what_the_library_does_not_keep() {
    use lofty::tag::ItemKey;

    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("tags-details");
    let flac = root.join("a.flac");
    common::flac(&flac, 21, 2);
    common::set_tags(&flac, "Song", "Someone", None, None);

    let bare = read_details(&flac).unwrap();
    assert_eq!(bare.publisher, None);
    assert_eq!(bare.isrc, None);
    assert_eq!(bare.size_bytes, std::fs::metadata(&flac).unwrap().len());
    assert!(bare.sample_rate.is_some() && bare.channels.is_some() && bare.bit_depth.is_some());

    add_text(&flac, &[(ItemKey::Label, "A Label")]);
    assert_eq!(read_details(&flac).unwrap().publisher.as_deref(), Some("A Label"), "a label stands in");

    add_text(
        &flac,
        &[
            (ItemKey::Publisher, " A Publisher "),
            (ItemKey::CopyrightMessage, "2026 Someone"),
            (ItemKey::Isrc, "GBMJG2627004"),
            (ItemKey::Composer, "A Composer"),
            (ItemKey::Bpm, "128"),
        ],
    );
    let details = read_details(&flac).unwrap();
    assert_eq!(details.publisher.as_deref(), Some("A Publisher"), "the publisher first, trimmed");
    assert_eq!(details.copyright.as_deref(), Some("2026 Someone"));
    assert_eq!(details.isrc.as_deref(), Some("GBMJG2627004"));
    assert_eq!(details.composer.as_deref(), Some("A Composer"));
    assert_eq!(details.bpm.as_deref(), Some("128"));

    // MP3: TPUB, TSRC, TCOP, TBPM, from ffmpeg rather than lofty's own writer.
    let mp3 = root.join("b.mp3");
    let made = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame"])
        .args(["-id3v2_version", "3", "-metadata", "publisher=An MP3 Publisher", "-metadata", "copyright=2025 Someone"])
        .args(["-metadata", "TSRC=USAAA2500001", "-metadata", "TBPM=90"])
        .arg(&mp3)
        .status()
        .unwrap();
    assert!(made.success());
    let details = read_details(&mp3).unwrap();
    assert_eq!(details.publisher.as_deref(), Some("An MP3 Publisher"));
    assert_eq!(details.copyright.as_deref(), Some("2025 Someone"));
    assert_eq!(details.isrc.as_deref(), Some("USAAA2500001"));
    assert_eq!(details.bpm.as_deref(), Some("90"));
    assert!(details.bitrate_kbps.is_some());
    let _ = std::fs::remove_dir_all(&root);
}
