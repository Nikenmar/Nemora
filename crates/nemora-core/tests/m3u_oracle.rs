//! The M3U resolver against android/base's own answers (`tools/oracle/m3u.ts`).

use nemora_core::m3u::{
    LibraryTrack, Resolver, clean_file_stem, compact_key, file_name_from_content_uri, location_to_path, parse,
};
use serde_json::Value;

fn load() -> Value {
    let path = format!("{}/../../fixtures/synthetic/oracle/m3u-expected.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn helpers_match_android_base() {
    let data = load();
    let mut failures = Vec::new();
    for h in data["helpers"].as_array().unwrap() {
        let input = h["input"].as_str().unwrap();
        let name = input.rsplit(['\\', '/']).next().unwrap();
        let checks = [
            ("compact", compact_key(input), h["compact"].as_str().unwrap().to_owned()),
            ("stem", clean_file_stem(name), h["stem"].as_str().unwrap().to_owned()),
            ("path", location_to_path(input), h["path"].as_str().unwrap().to_owned()),
        ];
        for (label, got, want) in checks {
            if got != want {
                failures.push(format!("{label}({input:?}) = {got:?}, android/base {want:?}"));
            }
        }
        let got = file_name_from_content_uri(input).map(|(f, d)| (f, d.unwrap_or_default()));
        let want = h["contentName"].as_object().map(|o| {
            (
                o["fileName"].as_str().unwrap().to_owned(),
                o.get("folderName").and_then(Value::as_str).unwrap_or_default().to_owned(),
            )
        });
        if got != want {
            failures.push(format!("content name({input:?}) = {got:?}, android/base {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{} helper mismatches:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn entries_resolve_as_on_android_base() {
    let data = load();
    let entries = parse(data["playlistText"].as_str().unwrap());
    let want_entries = data["entries"].as_array().unwrap();
    assert_eq!(entries.len(), want_entries.len());
    for (got, want) in entries.iter().zip(want_entries) {
        assert_eq!(got.location, want["location"].as_str().unwrap());
        assert_eq!(got.extinf_title.as_deref(), want["extinfTitle"].as_str());
        match (got.duration_sec, want["durationSec"].as_f64()) {
            (Some(a), Some(b)) => assert!((a - b).abs() < 1e-9, "{a} vs {b}"),
            (a, b) => assert_eq!(a, b, "duration of {}", got.location),
        }
    }

    let tracks: Vec<LibraryTrack> = data["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| LibraryTrack {
            song_id: t["songId"].as_str().unwrap().to_owned(),
            path: t["path"].as_str().unwrap().to_owned(),
            title: t["title"].as_str().unwrap().to_owned(),
            artists: t["artists"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_owned()).collect(),
            duration_sec: t["durationSec"].as_f64().unwrap(),
            file_name: None,
            folder_name: None,
        })
        .collect();
    let resolver = Resolver::new(tracks);
    let mut failures = Vec::new();
    let mut resolved_count = 0;
    for (entry, want) in entries.iter().zip(data["resolved"].as_array().unwrap()) {
        let got = resolver.resolve(entry).map(|(id, m)| (id, m.as_str().to_owned()));
        let want = want["songId"].as_str().map(|id| (id.to_owned(), want["method"].as_str().unwrap().to_owned()));
        resolved_count += usize::from(want.is_some());
        if got != want {
            failures.push(format!("{:?} / {:?}: {got:?}, android/base {want:?}", entry.location, entry.extinf_title));
        }
    }
    assert!(resolved_count > 200, "the oracle resolved only {resolved_count} entries");
    assert!(failures.is_empty(), "{} resolution mismatches:\n{}", failures.len(), failures.join("\n"));
}
