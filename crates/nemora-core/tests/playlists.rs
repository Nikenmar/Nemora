mod common;

use common::Tags;
use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::library::{self, SongScope, SongSort};
use nemora_core::playlists;
use nemora_core::scan::scan_folders;

#[test]
fn playlists_keep_songs_through_edits_and_import_m3u() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("playlists");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    for (i, (file, title, artist)) in
        [("01. Red X - Shiniest Sky.flac", "Shiniest Sky", "Red X"), ("Night Drive.flac", "Night Drive", "Lvstlove"), ("c.flac", "Gats", "Susumu Hirasawa")]
            .into_iter()
            .enumerate()
    {
        let path = music.join(file);
        common::flac(&path, 300 + i as u32, 2);
        common::set_full_tags(&path, Tags { title, artist, album: Some("Album"), ..Default::default() });
    }
    let mut db = Db::open(&root.join("nemora.db")).unwrap();
    let covers = CoverStore::new(root.join("covers"));
    scan_folders(&mut db, &covers, std::slice::from_ref(&music)).unwrap();
    let songs = library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 0, 10).unwrap().rows;
    let id_of = |title: &str| songs.iter().find(|s| s.title == title).unwrap().song_id.clone();

    // Create, add, move, remove.
    let p = playlists::create(&db, "Mine").unwrap();
    playlists::add(&mut db, &p, &[(id_of("Gats"), None), (id_of("Night Drive"), None), (id_of("Shiniest Sky"), None)], None).unwrap();
    playlists::move_item(&mut db, &p, 2, 0).unwrap();
    let titles = |db: &Db, missing: bool| playlists::items(db, &p, missing).unwrap().into_iter().map(|i| i.title).collect::<Vec<_>>();
    assert_eq!(titles(&db, false), ["Shiniest Sky", "Gats", "Night Drive"]);
    playlists::remove(&mut db, &p, &[1]).unwrap();
    assert_eq!(titles(&db, false), ["Shiniest Sky", "Night Drive"]);

    // A missing file stays in the playlist, hidden unless asked for, and comes back with the file.
    let away = root.join("away.flac");
    std::fs::rename(music.join("Night Drive.flac"), &away).unwrap();
    scan_folders(&mut db, &covers, std::slice::from_ref(&music)).unwrap();
    assert_eq!(titles(&db, false), ["Shiniest Sky"]);
    assert_eq!(titles(&db, true), ["Shiniest Sky", "Night Drive"]);
    assert!(!playlists::show_missing_in_playlists(&db).unwrap());
    std::fs::rename(&away, music.join("Night Drive.flac")).unwrap();
    scan_folders(&mut db, &covers, std::slice::from_ref(&music)).unwrap();
    assert_eq!(titles(&db, false), ["Shiniest Sky", "Night Drive"]);

    // Lists, pinning, renaming and tombstones.
    let q = playlists::create(&db, "Another").unwrap();
    playlists::set_pinned(&db, &q, Some(0)).unwrap();
    let names: Vec<String> = playlists::list(&db).unwrap().into_iter().map(|r| r.name).collect();
    assert_eq!(names, ["Another", "Mine"]);
    playlists::rename(&db, &q, "Renamed").unwrap();
    playlists::delete(&db, &q).unwrap();
    assert_eq!(playlists::list(&db).unwrap().len(), 1);
    assert_eq!(playlists::list(&db).unwrap()[0].song_count, 2);

    // An M3U from another device: different paths, a track-numbered name, an EXTINF match.
    let m3u = "#EXTM3U\n\
               #EXTINF:2,Red X - Shiniest Sky\n/storage/emulated/0/Music/01. Red X - Shiniest Sky.flac\n\
               #EXTINF:2,Susumu Hirasawa - Gats\n/sdcard/whatever/renamed.mp3\n\
               D:\\Old\\Night Drive.flac\n\
               #EXTINF:200,Nobody - Nothing\nC:\\none.mp3\n";
    let report = playlists::import_m3u(&mut db, "Imported", m3u).unwrap();
    assert_eq!((report.entries, report.resolved), (4, 3), "{report:?}");
    assert_eq!(report.unresolved, ["C:\\none.mp3"]);
    let imported: Vec<String> =
        playlists::items(&db, &report.playlist_id, false).unwrap().into_iter().map(|i| i.title).collect();
    assert_eq!(imported, ["Shiniest Sky", "Gats", "Night Drive"]);
    let exported = playlists::export_m3u(&db, &report.playlist_id).unwrap();
    assert!(exported.starts_with("#EXTM3U\n#EXTINF:2,Red X - Shiniest Sky\n"), "{exported}");
    assert_eq!(exported.lines().count(), 7);

    // Hearts and the blacklist reach the library lists.
    playlists::set_favorite(&db, &id_of("Gats"), true).unwrap();
    assert_eq!(library::songs(&db, &SongScope::Favorites, &SongSort::TitleAsc, 0, 10).unwrap().total, 1);
    playlists::set_favorite(&db, &id_of("Gats"), false).unwrap();
    assert_eq!(library::songs(&db, &SongScope::Favorites, &SongSort::TitleAsc, 0, 10).unwrap().total, 0);

    // Tierlists are documents.
    let t = playlists::save_tierlist(&db, None, &serde_json::json!({"name": "best", "tiers": [{"name": "S", "items": [id_of("Gats")]}]})).unwrap();
    assert_eq!(playlists::tierlists(&db).unwrap()[0].0, t);
    playlists::delete_tierlist(&db, &t).unwrap();
    assert!(playlists::tierlists(&db).unwrap().is_empty());

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}
