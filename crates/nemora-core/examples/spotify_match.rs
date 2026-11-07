//! A Spotify playlist matched against a library, printed: what the import would find.
//! `cargo run --release -p nemora-core --example spotify_match -- <nemora.db> <link> [<link>...]`
//! Give it a copy of the database: opening may migrate it.
use nemora_core::playlist_match::{Confidence, Matcher, library};

fn main() {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("a database");
    let db = nemora_core::db::Db::open(std::path::Path::new(&db_path)).expect("the database opens");
    let candidates = library(&db).expect("the library reads");
    let titles: std::collections::HashMap<String, String> =
        candidates.iter().map(|c| (c.song_id.clone(), format!("{} — {}", c.title, c.artists.join(", ")))).collect();
    let started = std::time::Instant::now();
    let matcher = Matcher::new(candidates);
    println!("index of {} songs in {:?}", titles.len(), started.elapsed());
    for link in args {
        let id = nemora_core::spotify::playlist_id(&link).expect("a playlist link");
        let playlist = nemora_core::spotify::fetch(&id).expect("the playlist reads");
        println!(
            "\n## {} by {:?}: {} tracks{}",
            playlist.name,
            playlist.owner,
            playlist.tracks.len(),
            if playlist.may_be_cut { " (may be cut)" } else { "" }
        );
        let (mut exact, mut likely, mut missing) = (0, 0, 0);
        for track in &playlist.tracks {
            let wanted =
                format!("{} — {} ({}s)", track.title, track.artists.join(", "), track.duration_ms.unwrap_or(0) / 1000);
            match matcher.find(track) {
                Some(found) if found.confidence == Confidence::Exact => {
                    exact += 1;
                    println!("  =  {wanted}");
                }
                Some(found) => {
                    likely += 1;
                    println!("  ~  {wanted}\n       -> {}", titles[&found.song_id]);
                }
                None => {
                    missing += 1;
                    println!("  -  {wanted}");
                }
            }
        }
        println!("exact {exact}, likely {likely}, missing {missing}");
    }
}
