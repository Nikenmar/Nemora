//! End-to-end probe on real data: scan a music folder into a fresh profile, import a 1.x profile,
//! then read what the apps will show.
//!
//!   p2_probe <music folder> <1.x profile dir> <new profile dir> <today YYYY-MM-DD>
//!
//! The music folder and the 1.x profile are only read.

use std::path::PathBuf;
use std::time::Instant;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::library::{self, NameSort, SongScope, SongSort};
use nemora_core::stats::{Range, dashboard};
use nemora_core::{elo, import, rediscover, scan, search, shuffle};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (music, old, profile, today) =
        (PathBuf::from(&args[0]), PathBuf::from(&args[1]), PathBuf::from(&args[2]), args[3].clone());
    std::fs::create_dir_all(&profile).unwrap();
    let mut db = Db::open(&profile.join("nemora.db")).unwrap();
    let started = Instant::now();
    let s = scan::scan_folders(&mut db, &CoverStore::new(profile.join("covers")), &[music]).unwrap();
    println!("scan: {} files, {} failed, {:.2?}", s.files, s.failed.len(), started.elapsed());
    let started = Instant::now();
    let r = import::import_nemora_1x(&mut db, &old).unwrap();
    println!(
        "import: by path {}, pending {}, ratings {}, {:.2?}",
        r.songs_by_path,
        r.pending,
        r.ratings,
        started.elapsed()
    );

    let started = Instant::now();
    let d = dashboard(&db, Range::AllTime, &today).unwrap();
    println!("\ndashboard (all time, {:.2?}):", started.elapsed());
    println!(
        "  plays {} | full {} | skips {} | distinct songs {} | listening {:.1} h",
        d.totals.plays,
        d.totals.full,
        d.totals.skips,
        d.totals.distinct_songs,
        d.totals.listening_ms as f64 / 3.6e6
    );
    println!(
        "  years {:?} | streak now {} / longest {} | most active {:?}",
        d.available_years,
        d.calendar.current_streak,
        d.calendar.longest_streak,
        d.calendar.most_active_day.as_ref().map(|b| (&b.label, b.plays))
    );
    println!(
        "  hours since {:?}, peak hour {:?}",
        d.hours_since,
        d.hours.iter().enumerate().max_by_key(|(_, n)| **n).map(|(h, _)| h)
    );
    for s in d.top_songs.iter().take(5) {
        println!("  top song: {} - {} ({})", s.artists.join(", "), s.title, s.plays);
    }
    for a in d.top_artists.iter().take(5) {
        println!("  top artist: {} ({})", a.name, a.plays);
    }
    let month = dashboard(&db, Range::Last30Days, &today).unwrap();
    println!("  last 30 days: {} plays over {} songs", month.totals.plays, month.totals.distinct_songs);

    let (top, recent) = elo::standings(&db, 5, 3).unwrap();
    println!("\nelo: {} duels in total", elo::total_duels(&db).unwrap());
    for s in &top {
        let title: String = library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 0, 5000)
            .unwrap()
            .rows
            .into_iter()
            .find(|r| r.song_id == s.song_id)
            .map(|r| r.title)
            .unwrap_or_default();
        println!("  {:.1} (effective {:.1}, {} games) {title}", s.rating.rating, s.effective, s.rating.games);
    }
    println!("  latest duel at {:?}", recent.first().map(|d| d.at));

    let started = Instant::now();
    let picks = rediscover::stored(&db, 30, &today).unwrap();
    println!("\nrediscover: {} songs ({:.2?})", picks.len(), started.elapsed());
    let started = Instant::now();
    let weights = shuffle::stored_weights(&db, &[], 0.6).unwrap();
    let mut w: Vec<f64> = weights.values().copied().collect();
    w.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "shuffle weights: {} songs, min {:.3} median {:.3} max {:.3} ({:.2?})",
        w.len(),
        w[0],
        w[w.len() / 2],
        w[w.len() - 1],
        started.elapsed()
    );

    let albums = library::albums(&db, NameSort::NameAsc).unwrap();
    let artists = library::artists(&db, NameSort::NameAsc).unwrap();
    println!("\nlibrary: {} albums, {} artists", albums.len(), artists.len());
    let started = Instant::now();
    let corpus = library::search_corpus(&db).unwrap();
    println!("search corpus: {:.2?}", started.elapsed());
    for q in ["oneheart", "iwakura melancholy", "spurme", "nujabes", "uicideboy", "zvezda"] {
        let started = Instant::now();
        let r = search::search(&corpus, search::Filter::All, q);
        println!(
            "  {q:?}: {} songs, {} artists, {} albums ({:.2?})",
            r.songs.len(),
            r.artists.len(),
            r.albums.len(),
            started.elapsed()
        );
    }
}
