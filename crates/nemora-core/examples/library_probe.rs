//! Development probe: scan a real music folder into a throwaway profile and report.
//!
//!   library_probe <music folder> <profile dir>
//!
//! The music folder is only read. The profile dir receives `nemora.db` and `covers/`.

use std::path::{Path, PathBuf};
use std::time::Instant;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::scan::scan_folders;

fn dir_size(path: &Path) -> (u64, usize) {
    let mut total = (0, 0);
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let (b, n) = dir_size(&p);
                total = (total.0 + b, total.1 + n);
            } else if let Ok(m) = entry.metadata() {
                total = (total.0 + m.len(), total.1 + 1);
            }
        }
    }
    total
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (music, profile) = (PathBuf::from(&args[0]), PathBuf::from(&args[1]));
    std::fs::create_dir_all(&profile).unwrap();
    let mut db = Db::open(&profile.join("nemora.db")).unwrap();
    let covers = CoverStore::new(profile.join("covers"));
    let roots = vec![music];

    for pass in ["first scan", "rescan"] {
        let started = Instant::now();
        let report = scan_folders(&mut db, &covers, &roots).unwrap();
        println!(
            "{pass}: {:.2?}  files {} added {} updated {} unchanged {} missing {} covers written {} failed {}",
            started.elapsed(),
            report.files,
            report.added,
            report.updated,
            report.unchanged,
            report.missing,
            report.covers_written,
            report.failed.len()
        );
        for (uri, reason) in report.failed.iter().take(10) {
            println!("  FAILED {uri}: {reason}");
        }
    }
    drop(db);
    let conn = rusqlite::Connection::open(profile.join("nemora.db")).unwrap();
    for (label, sql) in [
        ("tracks", "SELECT count(*) FROM tracks"),
        ("library rows (variants)", "SELECT count(*) FROM track_variants"),
        ("locations", "SELECT count(*) FROM locations"),
        ("distinct covers", "SELECT count(*) FROM covers"),
        ("rows without cover", "SELECT count(*) FROM track_variants WHERE cover_hash IS NULL"),
        ("albums (title + first album artist or artist)", "SELECT count(DISTINCT coalesce(album,'') || char(0) || coalesce((SELECT name FROM variant_artists a WHERE a.variant_id = v.variant_id ORDER BY role = 'artist', position LIMIT 1),'')) FROM track_variants v WHERE album IS NOT NULL"),
        ("artists", "SELECT count(DISTINCT name) FROM variant_artists WHERE role = 'artist'"),
    ] {
        let n: i64 = conn.query_row(sql, [], |r| r.get(0)).unwrap();
        println!("{label}: {n}");
    }
    let (db_bytes, _) = (std::fs::metadata(profile.join("nemora.db")).map(|m| m.len()).unwrap_or(0), 0);
    let (cover_bytes, cover_files) = dir_size(&profile.join("covers"));
    println!("nemora.db: {:.1} MB", db_bytes as f64 / 1e6);
    println!("covers/: {:.1} MB in {cover_files} files", cover_bytes as f64 / 1e6);
}
