//! Scale benchmark for the scan (PLAN/12, "Scale").
//!
//!   scan_bench generate <dir> <count>   write <count> distinct tiny WAV files (100 folders)
//!   scan_bench run <dir> <profile dir>  first scan, unchanged rescan, rescan after touching 1%
//!
//! The files are 0.1 s of 8 kHz mono noise, distinct per index, with no tags or covers: the
//! benchmark measures walking, identity, tag reading and the database, not image work (covers were
//! measured on a real library).

use std::path::{Path, PathBuf};
use std::time::Instant;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;
use nemora_core::scan::scan_folders;

fn wav(index: u64) -> Vec<u8> {
    const RATE: u32 = 8000;
    const SAMPLES: u32 = 800;
    let mut out = Vec::with_capacity(44 + SAMPLES as usize * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + SAMPLES * 2).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(SAMPLES * 2).to_le_bytes());
    let mut state = index.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    for _ in 0..SAMPLES {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        out.extend_from_slice(&((state as i16) / 4).to_le_bytes());
    }
    out
}

fn generate(dir: &Path, count: u64) {
    let started = Instant::now();
    for i in 0..count {
        let folder = dir.join(format!("folder {:03}", i % 100));
        if i < 100 {
            std::fs::create_dir_all(&folder).unwrap();
        }
        std::fs::write(folder.join(format!("track {i:06}.wav")), wav(i)).unwrap();
    }
    println!("generated {count} files in {:.2?}", started.elapsed());
}

fn run(dir: &Path, profile: &Path) {
    std::fs::create_dir_all(profile).unwrap();
    let mut db = Db::open(&profile.join("nemora.db")).unwrap();
    let covers = CoverStore::new(profile.join("covers"));
    let roots = vec![dir.to_path_buf()];
    let pass = |label: &str, db: &mut Db| {
        let started = Instant::now();
        let r = scan_folders(db, &covers, &roots).unwrap();
        println!(
            "{label}: {:.2?}  files {} added {} updated {} unchanged {} failed {}",
            started.elapsed(),
            r.files,
            r.added,
            r.updated,
            r.unchanged,
            r.failed.len()
        );
    };
    pass("first scan", &mut db);
    pass("unchanged rescan", &mut db);
    // Rewrite 1% of the files with other audio: they must be found and re-identified.
    let count =
        std::fs::read_dir(dir).unwrap().flatten().map(|f| std::fs::read_dir(f.path()).unwrap().count()).sum::<usize>();
    for i in (0..count as u64).step_by(100) {
        let path = dir.join(format!("folder {:03}", i % 100)).join(format!("track {i:06}.wav"));
        std::fs::write(&path, wav(i + 1_000_000_000)).unwrap();
    }
    pass("rescan after changing 1%", &mut db);
    let size = std::fs::metadata(profile.join("nemora.db")).map(|m| m.len()).unwrap_or(0);
    println!("nemora.db: {:.1} MB", size as f64 / 1e6);
}

/// Reading the scanned library: pages per sort, grouped lists, the search corpus and queries.
fn query(profile: &Path) {
    use nemora_core::library::{self, NameSort, SongScope, SongSort};
    use nemora_core::search::{Filter, search};
    let db = Db::open(&profile.join("nemora.db")).unwrap();
    let time = |label: &str, f: &mut dyn FnMut() -> usize| {
        let started = Instant::now();
        let n = f();
        println!("{label}: {:.2?} ({n})", started.elapsed());
    };
    for (label, sort) in [
        ("page 1, title", SongSort::TitleAsc),
        ("page 1, artist", SongSort::ArtistAsc),
        ("page 1, year", SongSort::YearDesc),
        ("page 1, added", SongSort::AddedDesc),
        ("page 1, plays", SongSort::PlaysDesc),
        ("page 1, plays this month", SongSort::PlaysSinceDesc("2026-10-01".into())),
    ] {
        time(label, &mut || library::songs(&db, &SongScope::All, &sort, 0, 50).unwrap().rows.len());
    }
    time("page 1000, title", &mut || {
        library::songs(&db, &SongScope::All, &SongSort::TitleAsc, 50_000, 50).unwrap().rows.len()
    });
    time("albums", &mut || library::albums(&db, NameSort::NameAsc).unwrap().len());
    time("artists", &mut || library::artists(&db, NameSort::NameAsc).unwrap().len());
    let mut corpus = None;
    time("search corpus build", &mut || {
        corpus = Some(library::search_corpus(&db).unwrap());
        0
    });
    let corpus = corpus.unwrap();
    for q in ["track 012345", "folder 042", "trak 01234", "zzzz"] {
        time(&format!("search {q:?}"), &mut || search(&corpus, Filter::All, q).songs.len());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("generate") => generate(&PathBuf::from(&args[1]), args[2].parse().unwrap()),
        Some("run") => run(&PathBuf::from(&args[1]), &PathBuf::from(&args[2])),
        Some("query") => query(&PathBuf::from(&args[1])),
        _ => eprintln!("usage: scan_bench generate <dir> <count> | run <dir> <profile dir> | query <profile dir>"),
    }
}
