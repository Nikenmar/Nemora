//! One ranked search for the whole library: a port of 1.1.9 `core/search/search.ts`.
//!
//! Every candidate is scored across every spelling (plain, folded, digits spelled out,
//! transliterated, romanised, layout-swapped), lowest wins, guesses are dropped whenever anything
//! matched cleanly, and listens break ties within a band. The engine is pure: the library module
//! builds a [`Corpus`] from the database, and the tests compare it with the old TypeScript.

pub mod fold;
pub mod romanize;
pub mod score;

use std::collections::HashSet;

use fold::{Variant, query_variants, text_keys};
use score::LOOSE_SCORE_THRESHOLD;

/// Which field a match landed in: a tie-break only, far too small to cross a band.
const TITLE_FIELD: f64 = 0.0;
const COMBINED_FIELD: f64 = 4.0;
const ARTIST_FIELD: f64 = 8.0;
const ALBUM_FIELD: f64 = 12.0;
/// The most a well-played track can climb within its own band.
const MAX_POPULARITY_BONUS: f64 = 0.9;
const MAX_SUGGESTIONS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SongInput {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    /// Plays plus full listens: the tie-break among equal matches.
    pub popularity: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedInput {
    pub id: String,
    pub name: String,
}

/// A key with its spellings pre-encoded as UTF-16, the unit the scores are measured in.
struct Key {
    variants: Vec<(Vec<u16>, f64)>,
}

impl Key {
    fn new(value: &str) -> Self {
        let romanized = romanize::has_romanizable_script(value).then(|| romanize::romanize(value)).flatten();
        Self::from_variants(text_keys(value, romanized.as_deref()))
    }

    fn from_variants(variants: Vec<Variant>) -> Self {
        Self { variants: variants.into_iter().map(|v| (v.text.encode_utf16().collect(), v.penalty)).collect() }
    }

    fn empty() -> Self {
        Self { variants: Vec::new() }
    }
}

struct IndexedSong {
    input: SongInput,
    title: Key,
    artists: Vec<Key>,
    album: Key,
    combined: Key,
}

struct IndexedNamed {
    id: String,
    name: Key,
}

/// The searchable library. Building it is the expensive half (folding, transliterating and
/// romanising every name); it is rebuilt when the library changes, never per keystroke.
pub struct Corpus {
    songs: Vec<IndexedSong>,
    artists: Vec<IndexedNamed>,
    albums: Vec<IndexedNamed>,
    playlists: Vec<IndexedNamed>,
    genres: Vec<IndexedNamed>,
}

impl Corpus {
    pub fn build(
        songs: Vec<SongInput>,
        artists: Vec<NamedInput>,
        albums: Vec<NamedInput>,
        playlists: Vec<NamedInput>,
        genres: Vec<NamedInput>,
    ) -> Self {
        use rayon::prelude::*;
        let named = |entries: Vec<NamedInput>| -> Vec<IndexedNamed> {
            entries.into_par_iter().map(|e| IndexedNamed { name: Key::new(&e.name), id: e.id }).collect()
        };
        let songs = songs
            .into_par_iter()
            .map(|song| {
                let combined = std::iter::once(song.title.as_str())
                    .chain(song.artists.iter().map(String::as_str))
                    .collect::<Vec<_>>()
                    .join(" ");
                IndexedSong {
                    title: Key::new(&song.title),
                    artists: song.artists.iter().map(|a| Key::new(a)).collect(),
                    album: song.album.as_deref().map_or_else(Key::empty, Key::new),
                    combined: Key::new(&combined),
                    input: song,
                }
            })
            .collect();
        Self {
            songs,
            artists: named(artists),
            albums: named(albums),
            playlists: named(playlists),
            genres: named(genres),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    All,
    Songs,
    Artists,
    Albums,
    Playlists,
    Genres,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Results {
    pub songs: Vec<String>,
    pub artists: Vec<String>,
    pub albums: Vec<String>,
    pub playlists: Vec<String>,
    pub genres: Vec<String>,
    /// When nothing matched: the first words of titles that a shorter query would find.
    pub suggestions: Vec<String>,
}

/// Best score over every (query spelling x indexed spelling) pair.
fn score_key(query: &[(Vec<u16>, f64)], key: &Key, field: f64) -> f64 {
    let mut best = f64::INFINITY;
    for (q, q_penalty) in query {
        if q.is_empty() {
            continue;
        }
        for (k, k_penalty) in &key.variants {
            let s = score::score(q, k) + q_penalty + k_penalty;
            if s < best {
                best = s;
            }
        }
    }
    if best.is_finite() { best + field } else { best }
}

fn popularity_bonus(listens: i64) -> f64 {
    ((1.0 + listens.max(0) as f64).log10() * 0.3).min(MAX_POPULARITY_BONUS)
}

/// Guesses are a fallback: if anything matched cleanly, the loose ones go. Stable sort, so equal
/// scores keep library order, as in 1.x.
fn finish<T: Clone>(mut matches: Vec<(T, f64)>) -> Vec<T> {
    if matches.iter().any(|(_, s)| *s < LOOSE_SCORE_THRESHOLD) {
        matches.retain(|(_, s)| *s < LOOSE_SCORE_THRESHOLD);
    }
    matches.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    matches.into_iter().map(|(t, _)| t).collect()
}

fn encoded(query: &str) -> Vec<(Vec<u16>, f64)> {
    query_variants(query).into_iter().map(|v| (v.text.encode_utf16().collect(), v.penalty)).collect()
}

fn search_songs(corpus: &Corpus, query: &str) -> Vec<usize> {
    let q = encoded(query);
    if q.is_empty() {
        return Vec::new();
    }
    // Scored in parallel; `collect` keeps library order, which the stable sort relies on for ties.
    use rayon::prelude::*;
    let matches = corpus
        .songs
        .par_iter()
        .enumerate()
        .filter_map(|(index, song)| {
            let mut best = score_key(&q, &song.title, TITLE_FIELD);
            for artist in &song.artists {
                best = best.min(score_key(&q, artist, ARTIST_FIELD));
            }
            best = best.min(score_key(&q, &song.album, ALBUM_FIELD));
            best = best.min(score_key(&q, &song.combined, COMBINED_FIELD));
            best.is_finite().then(|| (index, best - popularity_bonus(song.input.popularity)))
        })
        .collect();
    finish(matches)
}

fn search_named(entries: &[IndexedNamed], query: &str) -> Vec<String> {
    let q = encoded(query);
    if q.is_empty() {
        return Vec::new();
    }
    let matches = entries
        .iter()
        .filter_map(|e| {
            let s = score_key(&q, &e.name, TITLE_FIELD);
            s.is_finite().then(|| (e.id.clone(), s))
        })
        .collect();
    finish(matches)
}

fn push_unique(target: &mut Vec<String>, seen: &mut HashSet<String>, ids: Vec<String>) {
    for id in ids {
        if seen.insert(id.clone()) {
            target.push(id);
        }
    }
}

/// Searches every kind of entry. `;` separates independent queries whose results are joined.
pub fn search(corpus: &Corpus, filter: Filter, value: &str) -> Results {
    let wants = |kind: Filter| filter == Filter::All || filter == kind;
    let mut results = Results::default();
    let mut seen: [HashSet<String>; 5] = Default::default();
    for keyword in value.split(';') {
        if wants(Filter::Songs) {
            let ids = search_songs(corpus, keyword).into_iter().map(|i| corpus.songs[i].input.id.clone()).collect();
            push_unique(&mut results.songs, &mut seen[0], ids);
        }
        if wants(Filter::Artists) {
            push_unique(&mut results.artists, &mut seen[1], search_named(&corpus.artists, keyword));
        }
        if wants(Filter::Albums) {
            push_unique(&mut results.albums, &mut seen[2], search_named(&corpus.albums, keyword));
        }
        if wants(Filter::Playlists) {
            push_unique(&mut results.playlists, &mut seen[3], search_named(&corpus.playlists, keyword));
        }
        if wants(Filter::Genres) {
            push_unique(&mut results.genres, &mut seen[4], search_named(&corpus.genres, keyword));
        }
    }

    let nothing = results.songs.is_empty()
        && results.artists.is_empty()
        && results.albums.is_empty()
        && results.playlists.is_empty()
        && results.genres.is_empty();
    if nothing && wants(Filter::Songs) {
        // Shorten the query one UTF-16 unit at a time, as 1.x did with `substring`.
        let mut units: Vec<u16> = value.encode_utf16().collect();
        while results.suggestions.len() < MAX_SUGGESTIONS && !units.is_empty() {
            units.pop();
            let input = String::from_utf16_lossy(&units);
            for index in search_songs(corpus, &input) {
                let title = &corpus.songs[index].input.title;
                let words = title.split(' ').take(3).collect::<Vec<_>>().join(" ");
                if !results.suggestions.contains(&words) {
                    results.suggestions.push(words);
                    break;
                }
            }
        }
    }
    results
}
