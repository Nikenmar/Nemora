mod common;

use common::Tags;
use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::library::{self, NameSort, SongScope, SongSort};
use nemora_core::plays::{EndReason, Fact, Session, record};
use nemora_core::scan::scan_folders;
use nemora_core::search::{Filter, search};

fn titles(db: &Db, scope: &SongScope, sort: &SongSort) -> Vec<String> {
    library::songs(db, scope, sort, 0, 100).unwrap().rows.into_iter().map(|r| r.title).collect()
}

#[test]
fn lists_sort_scope_and_group_the_present_library() {
    if !common::ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = common::temp_dir("library");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    let files = [
        (
            "a",
            Tags {
                title: "Crystals",
                artist: "Isolate.exe",
                album: Some("Crystals"),
                album_artist: Some("Isolate.exe"),
                genre: Some("Phonk"),
                year: Some("2021"),
                track: Some(1),
            },
        ),
        (
            "b",
            Tags {
                title: "Crystals (slowed)",
                artist: "Iwakura",
                album: Some("Crystals"),
                album_artist: Some("Iwakura"),
                genre: Some("Phonk"),
                year: Some("2023"),
                track: Some(1),
            },
        ),
        (
            "c",
            Tags {
                title: "Keygen 1",
                artist: "Soulariuz",
                album: Some("R2R"),
                album_artist: Some("Soulariuz, Team R2R"),
                year: Some("2010"),
                track: Some(2),
                ..Default::default()
            },
        ),
        (
            "d",
            Tags {
                title: "Keygen 2",
                artist: "Veniek",
                album: Some("R2R"),
                album_artist: Some("Veniek, Team R2R"),
                year: Some("2011"),
                track: Some(1),
                ..Default::default()
            },
        ),
        (
            "e",
            Tags {
                title: "Звезда", artist: "Кино", album: Some("Single"), genre: Some("Rock"), ..Default::default()
            },
        ),
        ("f", Tags { title: "Ёлки", artist: "Ёлка", album: Some("Single"), ..Default::default() }),
        ("g", Tags { title: "apple", artist: "Zed", ..Default::default() }),
    ];
    for (i, (name, tags)) in files.into_iter().enumerate() {
        let path = music.join(format!("{name}.flac"));
        common::flac(&path, 100 + i as u32, 2);
        common::set_full_tags(&path, tags);
    }
    let db_path = root.join("nemora.db");
    let mut db = Db::open(&db_path).unwrap();
    scan_folders(&mut db, &CoverStore::new(root.join("covers")), std::slice::from_ref(&music)).unwrap();

    // Titles sort by their normalised key in every script, with a stable tie-break.
    assert_eq!(
        titles(&db, &SongScope::All, &SongSort::TitleAsc),
        ["apple", "Crystals", "Crystals (slowed)", "Keygen 1", "Keygen 2", "Ёлки", "Звезда"]
    );
    assert_eq!(
        titles(&db, &SongScope::All, &SongSort::YearAsc)[..4],
        ["Keygen 1", "Keygen 2", "Crystals", "Crystals (slowed)"]
    );
    let page = library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 2, 3).unwrap();
    assert_eq!(page.total, 7);
    assert_eq!(
        page.rows.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
        ["Crystals (slowed)", "Keygen 1", "Keygen 2"]
    );

    // Albums: the same title with different album artists is two albums; overlapping album artists
    // (Team R2R) are one; no album artist groups by title alone, as in 1.1.9.
    let albums = library::albums(&db, NameSort::NameAsc).unwrap();
    let summary: Vec<(String, i64)> = albums.iter().map(|a| (a.title.clone(), a.song_count)).collect();
    assert_eq!(
        summary,
        [("Crystals".to_owned(), 1), ("Crystals".to_owned(), 1), ("R2R".to_owned(), 2), ("Single".to_owned(), 2)]
    );
    let r2r = albums.iter().find(|a| a.title == "R2R").unwrap();
    assert_eq!(titles(&db, &SongScope::Album(r2r.key.clone()), &SongSort::TrackAsc), ["Keygen 2", "Keygen 1"]);
    assert_eq!(r2r.year, Some(2010));

    // Artists include album artists; genres count songs.
    let artists = library::artists(&db, NameSort::SongsDesc).unwrap();
    assert_eq!(artists[0].name, "Team R2R");
    assert_eq!(artists[0].song_count, 2);
    assert_eq!(titles(&db, &SongScope::Artist("Кино".into()), &SongSort::TitleAsc), ["Звезда"]);
    let genres = library::genres(&db, NameSort::NameAsc).unwrap();
    assert_eq!(genres.iter().map(|g| (g.name.as_str(), g.song_count)).collect::<Vec<_>>(), [("Phonk", 2), ("Rock", 1)]);
    assert_eq!(titles(&db, &SongScope::Genre("Phonk".into()), &SongSort::TitleAsc), ["Crystals", "Crystals (slowed)"]);

    // Plays order the list once facts exist.
    let apple = library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 0, 1).unwrap().rows.remove(0);
    for _ in 0..2 {
        record(
            &mut db,
            &Session {
                song_id: apple.song_id.clone(),
                started_at: 1_700_000_000_000,
                utc_offset_min: 0,
                duration_ms: apple.duration_ms,
                source_kind: None,
                source_id: None,
                facts: vec![
                    Fact::Play { at_ms: 1_700_000_000_000, position_ms: 0 },
                    Fact::End { at_ms: 1_700_000_002_000, position_ms: 2000, reason: EndReason::Finished },
                ],
            },
        )
        .unwrap();
    }
    assert_eq!(titles(&db, &SongScope::All, &SongSort::PlaysDesc)[0], "apple");
    assert_eq!(library::songs(&db, &SongScope::All, &SongSort::PlaysDesc, 0, 1).unwrap().rows[0].plays, 2);
    // The plays were on 2023-11-14 (UTC): counted since that day, not since the next one, where
    // every song ties at zero and the title order decides.
    assert_eq!(titles(&db, &SongScope::All, &SongSort::PlaysSinceAsc("2023-11-14".into())).last().unwrap(), "apple");
    assert_eq!(
        titles(&db, &SongScope::All, &SongSort::PlaysSinceDesc("2023-11-15".into())),
        titles(&db, &SongScope::All, &SongSort::TitleAsc)
    );

    // Favourites and the blacklist are scopes.
    db_exec(&db_path, &format!("INSERT INTO favorites VALUES ('{}', 1, 0, 'x')", apple.song_id));
    assert_eq!(titles(&db, &SongScope::Favorites, &SongSort::TitleAsc), ["apple"]);
    db_exec(&db_path, &format!("INSERT INTO blacklist_songs VALUES ('{}', 1, 0, 'x')", apple.song_id));
    assert_eq!(titles(&db, &SongScope::Blacklisted, &SongSort::TitleAsc), ["apple"]);
    assert_eq!(titles(&db, &SongScope::NotBlacklisted, &SongSort::TitleAsc).len(), 6);

    // Search over the corpus built from the database.
    let corpus = library::search_corpus(&db).unwrap();
    let found = search(&corpus, Filter::All, "zvezda");
    assert_eq!(found.songs.len(), 1);
    assert_eq!(found.artists, Vec::<String>::new());
    assert_eq!(search(&corpus, Filter::All, "team r2r").artists, ["Team R2R"]);

    // A missing file leaves the lists.
    std::fs::remove_file(music.join("g.flac")).unwrap();
    scan_folders(&mut db, &CoverStore::new(root.join("covers")), &[music]).unwrap();
    assert_eq!(library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 0, 100).unwrap().total, 6);

    drop(db);
    let _ = std::fs::remove_dir_all(&root);
}

fn db_exec(path: &std::path::Path, sql: &str) {
    rusqlite::Connection::open(path).unwrap().execute(sql, []).unwrap();
}
