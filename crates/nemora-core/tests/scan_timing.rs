//! How long a rescan of a real library takes, step by step, on a COPY of a profile. Ignored by
//! default; run by hand:
//!
//!   set NEMORA_TIMING_DB=E:\tmp\scan-timing\nemora.db
//!   cargo test -p nemora-core --release --test scan_timing -- --ignored --nocapture
//!
//! The music files are only read. Covers go to a folder next to the copy.
use std::path::PathBuf;
use std::time::Instant;

use nemora_core::covers::CoverStore;
use nemora_core::db::Db;

#[test]
#[ignore = "needs NEMORA_TIMING_DB, a copy of a real profile"]
fn a_rescan_of_a_real_library() {
    let db_path = PathBuf::from(std::env::var("NEMORA_TIMING_DB").expect("NEMORA_TIMING_DB"));
    let mut db = Db::open(&db_path).expect("open the copy");
    let covers = CoverStore::new(db_path.with_file_name("covers-timing"));
    let roots: Vec<PathBuf> =
        nemora_core::settings::music_folders(&db).unwrap().into_iter().map(|f| f.path).collect();
    println!("roots {roots:?}");
    for run in 1..=3 {
        let t = Instant::now();
        let report = nemora_core::scan::scan_folders(&mut db, &covers, &roots).unwrap();
        println!(
            "run {run}: {:?}  files {} unchanged {} added {} updated {} restored {} missing {}",
            t.elapsed(),
            report.files,
            report.unchanged,
            report.added,
            report.updated,
            report.restored,
            report.missing
        );
    }
}
