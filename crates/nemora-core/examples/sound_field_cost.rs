//! What reading Switch version's field costs a scan: `read_field` over the files of a folder,
//! read only. `cargo run --release -p nemora-core --example sound_field_cost -- <folder> [limit]`
use std::time::Instant;

fn main() {
    let mut args = std::env::args().skip(1);
    let folder = args.next().expect("a folder");
    let limit: usize = args.next().and_then(|n| n.parse().ok()).unwrap_or(500);
    let files: Vec<_> = std::fs::read_dir(&folder)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| matches!(e.to_str(), Some("mp3" | "flac" | "m4a" | "ogg" | "opus"))))
        .take(limit)
        .collect();
    let started = Instant::now();
    let mut with = 0;
    for path in &files {
        if nemora_core::song_sound::read_field(path).ok().flatten().is_some() {
            with += 1;
        }
    }
    let field = started.elapsed();
    let started = Instant::now();
    for path in &files {
        let _ = nemora_core::tags::read_tags(path);
    }
    let tags = started.elapsed();
    println!(
        "{} files: field {:.1} ms ({:.2} ms each), read_tags {:.1} ms ({:.2} ms each), {} with a field",
        files.len(),
        field.as_secs_f64() * 1000.0,
        field.as_secs_f64() * 1000.0 / files.len().max(1) as f64,
        tags.as_secs_f64() * 1000.0,
        tags.as_secs_f64() * 1000.0 / files.len().max(1) as f64,
        with
    );
}
