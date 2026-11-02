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
        let mut keys = text_keys(value, romanized.as_deref());
        // Japanese readings of kanji and words apart (PLAN/20 D1), beside 1.x's keys; and `й` as
        // `i` as well as `y` (`Мой байк` is typed `moi baik` as often as `moy bayk`).
        let mut extra = romanize::japanese_readings(value);
        if value.contains(['й', 'Й']) {
            extra.push(fold::transliterate(&value.replace('й', "и").replace('Й', "И")));
        }
        for reading in extra {
            if !keys.iter().any(|k| k.text == reading) {
                keys.push(Variant { text: reading, penalty: fold::TRANSLIT_PENALTY });
            }
        }
        Self::from_variants(keys)
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
    /// When songs matched only with typos (PLAN/20 D1): the spelling the best of them matched, as a
    /// one-click correction (`mushku tensei` -> `mushoku tensei`).
    pub did_you_mean: Option<String>,
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

/// The indexed spelling of `key` the query matched best, and that score (field not added).
fn best_spelling(query: &[(Vec<u16>, f64)], key: &Key) -> Option<(f64, String)> {
    let mut best: Option<(f64, &Vec<u16>)> = None;
    for (q, q_penalty) in query {
        if q.is_empty() {
            continue;
        }
        for (k, k_penalty) in &key.variants {
            let s = score::score(q, k) + q_penalty + k_penalty;
            if s.is_finite() && best.is_none_or(|(b, _)| s < b) {
                best = Some((s, k));
            }
        }
    }
    best.map(|(s, k)| (s, String::from_utf16_lossy(k)))
}

/// Did you mean (PLAN/20 D1): when the best song matched only in the typo band, the spelling it
/// matched (its title or artist as indexed, a reading included), unless that is the query itself.
fn did_you_mean(corpus: &Corpus, query: &str, best: usize) -> Option<String> {
    let q = encoded(query);
    let song = &corpus.songs[best];
    let (score, spelling) = std::iter::once(&song.title)
        .chain(song.artists.iter())
        .filter_map(|key| best_spelling(&q, key))
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))?;
    let typo = (LOOSE_SCORE_THRESHOLD..LOOSE_SCORE_THRESHOLD + 400.0).contains(&score);
    // As many words as were typed: the correction of the query, not the whole title.
    let words = fold::normalize(query).split(' ').filter(|w| !w.is_empty()).count().max(1);
    let spelling = spelling.split(' ').take(words).collect::<Vec<_>>().join(" ");
    (typo && spelling != fold::normalize(query)).then_some(spelling)
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
    let mut variants = query_variants(query);
    // Readings run together (`risa ga inai` for `risagainai`): words apart in a query need not be
    // apart in a romanised title (PLAN/20 D1).
    if let Some(first) = variants.first() {
        let together: String = first.text.split(' ').collect();
        if together != first.text && !variants.iter().any(|v| v.text == together) {
            variants.push(Variant { text: together, penalty: fold::TRANSLIT_PENALTY });
        }
    }
    variants.into_iter().map(|v| (v.text.encode_utf16().collect(), v.penalty)).collect()
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
            let found = search_songs(corpus, keyword);
            if results.did_you_mean.is_none()
                && let Some(&best) = found.first()
            {
                results.did_you_mean = did_you_mean(corpus, keyword, best);
            }
            let ids = found.into_iter().map(|i| corpus.songs[i].input.id.clone()).collect();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn corpus() -> Corpus {
        let song = |id: &str, title: &str, artist: &str| SongInput {
            id: id.into(),
            title: title.into(),
            artists: vec![artist.into()],
            album: None,
            popularity: 0,
        };
        Corpus::build(
            vec![
                song("a", "無職転生", "藤澤慶昌"),
                song("b", "夜に駆ける", "YOASOBI"),
                song("c", "Nirvana Song", "Nirvana"),
            ],
            vec![],
            vec![],
            vec![],
            vec![],
        )
    }

    #[test]
    fn kanji_are_read_as_japanese_with_words_apart_and_run_together() {
        let c = corpus();
        assert_eq!(search(&c, Filter::Songs, "mushoku tensei").songs, ["a"]);
        assert_eq!(search(&c, Filter::Songs, "mushokutensei").songs, ["a"]);
        assert_eq!(search(&c, Filter::Songs, "yoru ni kakeru").songs, ["b"]);
        assert_eq!(search(&c, Filter::Songs, "fujisawa").songs, ["a"], "an artist in kanji");
    }

    #[test]
    fn a_typo_offers_the_spelling_it_matched() {
        let c = corpus();
        let r = search(&c, Filter::Songs, "mushku tensei");
        assert_eq!(r.songs, ["a"]);
        assert_eq!(r.did_you_mean.as_deref(), Some("mushoku tensei"));
        let clean = search(&c, Filter::Songs, "mushoku");
        assert_eq!(clean.did_you_mean, None, "a clean hit offers nothing");
        assert_eq!(search(&c, Filter::Songs, "nirvnaa").did_you_mean.as_deref(), Some("nirvana"));
        let longer = Corpus::build(
            vec![SongInput {
                id: "x".into(),
                title: "無職転生 (Jobless Reincarnation)".into(),
                artists: vec![],
                album: None,
                popularity: 0,
            }],
            vec![],
            vec![],
            vec![],
            vec![],
        );
        assert_eq!(search(&longer, Filter::Songs, "mushku tensei").did_you_mean.as_deref(), Some("mushoku tensei"));
    }
}

#[cfg(test)]
mod perf {
    use super::*;

    /// PLAN/20's budget: a search under 30 ms at 20 000 songs, a tenth of them Japanese (readings
    /// indexed), typos and readings in the queries.
    #[test]
    #[ignore]
    fn perf_search_at_20000_songs() {
        let latin = [
            "night", "drive", "ocean", "silver", "dream", "fire", "city", "lights", "echo", "winter", "heart", "glass",
        ];
        let japanese =
            ["無職", "転生", "夜", "駆ける", "祈り", "天使", "時間", "少女", "静脈", "陽だまり", "鏡", "空想"];
        let mut x: u64 = 11;
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x as usize
        };
        let songs: Vec<SongInput> = (0..20_000)
            .map(|i| {
                let title = if i % 10 == 0 {
                    format!("{}の{}", japanese[next() % 12], japanese[next() % 12])
                } else {
                    format!("{} {} {}", latin[next() % 12], latin[next() % 12], i)
                };
                SongInput {
                    id: i.to_string(),
                    title,
                    artists: vec![format!("Artist {}", next() % 2000)],
                    album: Some(format!("Album {}", next() % 3000)),
                    popularity: (next() % 50) as i64,
                }
            })
            .collect();
        let t = std::time::Instant::now();
        let corpus = Corpus::build(songs, vec![], vec![], vec![], vec![]);
        let built = t.elapsed();
        let mut worst = std::time::Duration::ZERO;
        for q in [
            "mushoku tensei",
            "mushku tensei",
            "yoru no kakeru",
            "silver dream",
            "slver drem",
            "ocean",
            "a",
            "artist 1999",
            "tenshi",
        ] {
            let t = std::time::Instant::now();
            let r = search(&corpus, Filter::All, q);
            let took = t.elapsed();
            worst = worst.max(took);
            println!("{q:16} {:5} songs in {took:?}", r.songs.len());
        }
        println!("PERF search 20k: corpus built in {built:?}, worst search {worst:?}");
        assert!(worst.as_millis() < 30, "search budget 30 ms: {worst:?}");
    }
}
