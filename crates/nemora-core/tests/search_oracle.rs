//! The search port against 1.1.9's own answers (`tools/oracle/search.ts` ran the old TypeScript on
//! `fixtures/synthetic/oracle/search-corpus.json`). Every layer is compared: the keys a name is
//! indexed under, the spellings a query is tried in, the score of each pair, and the final ranked
//! results.

use nemora_core::search::fold::{query_variants, text_keys};
use nemora_core::search::romanize::{has_romanizable_script, romanize};
use nemora_core::search::score::score;
use nemora_core::search::{Corpus, Filter, NamedInput, SongInput, search};
use serde_json::Value;

/// Names whose romanisation differs by design: hangul is romanised syllable by syllable
/// (see `search/romanize.rs`). Empty while no corpus entry is affected.
const KNOWN_ROMANIZATION_DIFFERENCES: &[&str] = &[];

fn load(name: &str) -> Value {
    let path = format!("{}/../../fixtures/synthetic/oracle/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn variants_json(v: Vec<nemora_core::search::fold::Variant>) -> Vec<(String, f64)> {
    v.into_iter().map(|v| (v.text, v.penalty)).collect()
}

fn expected_variants(v: &Value) -> Vec<(String, f64)> {
    v.as_array().unwrap().iter().map(|k| (k["text"].as_str().unwrap().to_owned(), k["penalty"].as_f64().unwrap())).collect()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_owned()).collect()
}

#[test]
fn indexed_keys_match_1x() {
    let expected = load("search-expected.json");
    let mut failures = Vec::new();
    for entry in expected["keys"].as_array().unwrap() {
        let text = entry["text"].as_str().unwrap();
        if KNOWN_ROMANIZATION_DIFFERENCES.contains(&text) {
            continue;
        }
        let romanized = has_romanizable_script(text).then(|| romanize(text)).flatten();
        let want_romanized = entry["romanized"].as_str().map(str::to_owned);
        if romanized != want_romanized {
            failures.push(format!("romanize({text:?}): {romanized:?}, 1.x {want_romanized:?}"));
            continue;
        }
        let got = variants_json(text_keys(text, romanized.as_deref()));
        let want = expected_variants(&entry["keys"]);
        if got != want {
            failures.push(format!("keys({text:?}):\n  got  {got:?}\n  1.x  {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{} key mismatches:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn query_variants_match_1x() {
    let expected = load("search-expected.json");
    let mut failures = Vec::new();
    for entry in expected["queries"].as_array().unwrap() {
        let query = entry["query"].as_str().unwrap();
        let got = variants_json(query_variants(query));
        let want = expected_variants(&entry["variants"]);
        if got != want {
            failures.push(format!("variants({query:?}):\n  got  {got:?}\n  1.x  {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{} variant mismatches:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn scores_match_1x() {
    let expected = load("search-expected.json");
    let mut failures = Vec::new();
    let pairs = expected["scores"].as_array().unwrap();
    for pair in pairs {
        let (q, v) = (pair["query"].as_str().unwrap(), pair["value"].as_str().unwrap());
        let got = score(&q.encode_utf16().collect::<Vec<_>>(), &v.encode_utf16().collect::<Vec<_>>());
        let ok = match pair["score"].as_f64() {
            Some(want) => (got - want).abs() < 1e-9,
            None => got.is_infinite(),
        };
        if !ok {
            failures.push(format!("score({q:?}, {v:?}) = {got}, 1.x {}", pair["score"]));
        }
    }
    assert!(pairs.len() > 1000, "the oracle should have produced many pairs");
    assert!(failures.is_empty(), "{} of {} score mismatches:\n{}", failures.len(), pairs.len(), failures.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
}

#[test]
fn ranked_results_match_1x() {
    let corpus_json = load("search-corpus.json");
    let expected = load("search-expected.json");
    let named = |key: &str| -> Vec<NamedInput> {
        corpus_json[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| NamedInput { id: n["id"].as_str().unwrap().to_owned(), name: n["name"].as_str().unwrap().to_owned() })
            .collect()
    };
    let songs = corpus_json["songs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| SongInput {
            id: s["id"].as_str().unwrap().to_owned(),
            title: s["title"].as_str().unwrap().to_owned(),
            artists: strings(&s["artists"]),
            album: s["album"].as_str().map(str::to_owned),
            popularity: s["popularity"].as_i64().unwrap(),
        })
        .collect();
    let corpus = Corpus::build(songs, named("artists"), named("albums"), named("playlists"), named("genres"));

    let mut failures = Vec::new();
    for want in expected["searches"].as_array().unwrap() {
        let query = want["query"].as_str().unwrap();
        let got = search(&corpus, Filter::All, query);
        for (label, got_ids, key) in [
            ("songs", &got.songs, "songs"),
            ("artists", &got.artists, "artists"),
            ("albums", &got.albums, "albums"),
            ("playlists", &got.playlists, "playlists"),
            ("genres", &got.genres, "genres"),
            ("suggestions", &got.suggestions, "suggestions"),
        ] {
            let want_ids = strings(&want[key]);
            if *got_ids != want_ids {
                failures.push(format!("search({query:?}).{label}: {got_ids:?}, 1.x {want_ids:?}"));
            }
        }
    }
    assert!(failures.is_empty(), "{} result mismatches:\n{}", failures.len(), failures.join("\n"));
}
