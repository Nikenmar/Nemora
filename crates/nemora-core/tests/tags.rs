mod common;

use nemora_core::identity::identify_path;
use nemora_core::tags::{TagEdit, read_tags, write_tags};

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
