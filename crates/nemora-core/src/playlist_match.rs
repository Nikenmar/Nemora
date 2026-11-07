//! Finding a playlist's tracks from another service (Spotify) in the library, by what both sides
//! know of a track: its title, its artists and its length.
//!
//! The two sides spell the same recording differently: case, accents, fullwidth or stylised
//! letters, Cyrillic or Japanese against a Latin reading, `feat.` in the title or among the
//! artists, `(Remastered 2011)` on one side only. Each title and artist is compared under every key
//! the search uses (`search::fold`: plain, folded, digits spelled, transliterated, romanized).
//!
//! What must never match is another version of the song: `Slowed`, `Sped Up`, `Nightcore`, a
//! remix, a live take. A title's version words are read apart from the title and have to be the
//! same on both sides; words that do not make another recording (remastered, radio edit, original
//! mix) are dropped.
//!
//! A match is `Exact` when the title, an artist and the length (within 3 s) agree, and `Likely`
//! when one of them is looser: the length within 10 s, or a title that differs by a letter or two.

use std::collections::{BTreeSet, HashMap, HashSet};

use regex::Regex;

use crate::db::Db;
use crate::error::Result;
use crate::search::fold;
use crate::search::romanize::romanize;

/// A track as the other service gives it.
#[derive(Debug, Clone, PartialEq)]
pub struct Wanted {
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: Option<u64>,
}

/// A song of the library.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub song_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    Exact,
    Likely,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub song_id: String,
    pub confidence: Confidence,
}

/// Lengths this close are the same recording.
const SAME_LENGTH_MS: u64 = 3_000;
/// ...and this close, with the rest agreeing, probably still are (another master, a silence cut).
const NEAR_LENGTH_MS: u64 = 10_000;
/// A title this similar (0..1, by edit distance) counts for a likely match.
const NEAR_TITLE: f64 = 0.85;

/// A title taken apart: the name itself under each key, and the version words.
#[derive(Debug, Clone, PartialEq)]
struct Title {
    keys: Vec<String>,
    /// The main key (folded), for the near-title comparison.
    main: String,
    version: BTreeSet<String>,
    featured: Vec<String>,
}

fn regexes() -> &'static (Regex, Regex, Regex, Regex) {
    static RE: std::sync::OnceLock<(Regex, Regex, Regex, Regex)> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        (
            // A bracketed part anywhere in the title.
            Regex::new(r"[(\[{（【]([^)\]}）】]*)[)\]}）】]").unwrap(),
            // A part after a dash: "Song - Slowed", "Song - Remastered 2011".
            Regex::new(r"\s[-–—]\s+(.+)$").unwrap(),
            // A credit inside a title part.
            Regex::new(r"(?i)^\s*(?:feat\.?|ft\.?|featuring|with|prod\.?(?:\s+by)?)\s+(.+)$").unwrap(),
            // The same credit not in brackets, at the end of the title.
            Regex::new(r"(?i)\s(?:feat\.?|ft\.?|featuring)\s+(.+)$").unwrap(),
        )
    })
}

/// Version words: each one makes another recording. Longest first, so "super slowed" is not read
/// as "slowed".
const VERSION_WORDS: &[(&str, &str)] = &[
    ("ultra slowed", "ultra slowed"),
    ("mega slowed", "mega slowed"),
    ("hyper slowed", "hyper slowed"),
    ("super slowed", "super slowed"),
    ("slowed down", "slowed"),
    ("slowed", "slowed"),
    ("sped up", "sped up"),
    ("speed up", "sped up"),
    ("spedup", "sped up"),
    ("sped-up", "sped up"),
    ("nightcore", "nightcore"),
    ("daycore", "daycore"),
    ("reverb", "reverb"),
    ("bass boosted", "bass boosted"),
    ("8d audio", "8d"),
    ("8d", "8d"),
    ("instrumental", "instrumental"),
    ("acapella", "acapella"),
    ("a cappella", "acapella"),
    ("acoustic", "acoustic"),
    ("live", "live"),
    ("karaoke", "karaoke"),
    ("extended", "extended"),
    ("cover", "cover"),
    ("demo", "demo"),
    ("unplugged", "unplugged"),
];

/// Words that mark a part as the same recording: the part is dropped.
const SAME_RECORDING: &[&str] = &[
    "remaster",
    "remastered",
    "radio edit",
    "radio version",
    "single version",
    "album version",
    "original mix",
    "original version",
    "explicit",
    "clean",
    "mono",
    "stereo",
    "deluxe",
    "bonus track",
];

fn words(value: &str) -> String {
    fold::normalize(value)
}

/// What a title part is: version words (another recording), a credit, a same-recording note, or
/// part of the name.
enum Part {
    Version(Vec<String>),
    Credit(Vec<String>),
    Same,
    Name,
}

fn read_part(part: &str) -> Part {
    let (_, _, credit, _) = regexes();
    if let Some(found) = credit.captures(part) {
        return Part::Credit(split_artists(&found[1]));
    }
    let plain = words(part);
    if plain.is_empty() {
        return Part::Same;
    }
    // A remix names its remixer: "XYZ Remix" is its own recording, unlike another remix.
    if plain.ends_with(" remix")
        || plain == "remix"
        || plain.ends_with(" rmx")
        || plain.ends_with(" mix") && !plain.contains("original")
    {
        return Part::Version(vec![plain]);
    }
    let mut found = Vec::new();
    let mut rest = format!(" {plain} ");
    for (word, canonical) in VERSION_WORDS {
        let spaced = format!(" {word} ");
        if rest.contains(&spaced) {
            found.push((*canonical).to_owned());
            rest = rest.replace(&spaced, " ");
        }
    }
    let rest_words: Vec<&str> =
        rest.split_whitespace().filter(|w| !matches!(*w, "and" | "x" | "version" | "ver" | "edit")).collect();
    if !found.is_empty() && rest_words.is_empty() {
        return Part::Version(found);
    }
    let is_same = SAME_RECORDING
        .iter()
        .any(|w| plain == *w || plain.starts_with(&format!("{w} ")) || plain.ends_with(&format!(" {w}")))
        || (plain.contains("remaster")
            && plain.split_whitespace().all(|w| w.contains("remaster") || w.chars().all(|c| c.is_ascii_digit())));
    if is_same {
        return Part::Same;
    }
    if !found.is_empty() {
        // Version words beside others ("Slowed by someone"): still another recording.
        return Part::Version(found);
    }
    Part::Name
}

/// Every key a name is compared under.
fn keys_of(value: &str) -> Vec<String> {
    let romanized = romanize(value);
    let mut keys: Vec<String> = fold::text_keys(value, romanized.as_deref()).into_iter().map(|v| v.text).collect();
    let ascii = fold::normalize(&any_ascii::any_ascii(value));
    if !ascii.is_empty() && !keys.contains(&ascii) {
        keys.push(ascii);
    }
    // Kanji read as words (lindera), which a reading of the kana alone leaves out.
    for reading in crate::search::romanize::japanese_readings(value) {
        let reading = fold::normalize(&reading);
        if !reading.is_empty() && !keys.contains(&reading) {
            keys.push(reading);
        }
    }
    // The same words run together: "for tuna" and "fortuna", "BRODYAGA SYNTH" and "Brodyaga-Synth".
    let joined: Vec<String> = keys.iter().map(|k| k.replace(' ', "")).filter(|k| !k.is_empty()).collect();
    for key in joined {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys.retain(|k| !k.is_empty());
    keys
}

fn read_title(title: &str) -> Title {
    let (brackets, dash, _, trailing_credit) = regexes();
    let mut version = BTreeSet::new();
    let mut featured = Vec::new();
    let mut name = title.to_owned();
    // Brackets first, then a dash part, then a bare "feat." left at the end.
    let parts: Vec<(String, String)> =
        brackets.captures_iter(title).map(|c| (c[0].to_owned(), c[1].to_owned())).collect();
    let mut kept_names = Vec::new();
    for (whole, inner) in parts {
        match read_part(&inner) {
            Part::Version(found) => version.extend(found),
            Part::Credit(artists) => featured.extend(artists),
            Part::Same => {}
            Part::Name => {
                kept_names.push(inner.clone());
                continue;
            }
        }
        name = name.replacen(&whole, " ", 1);
    }
    while let Some(found) = dash.captures(&name) {
        let whole = found[0].to_owned();
        match read_part(&found[1]) {
            Part::Version(found) => version.extend(found),
            Part::Credit(artists) => featured.extend(artists),
            Part::Same => {}
            Part::Name => break,
        }
        name = name.replacen(&whole, "", 1);
    }
    if let Some(found) = trailing_credit.captures(&name) {
        let whole = found[0].to_owned();
        featured.extend(split_artists(&found[1]));
        name = name.replacen(&whole, "", 1);
    }
    let mut keys = keys_of(&name);
    // A name in brackets beside another ("無職転生 (Jobless Reincarnation)"): each alone too.
    if !kept_names.is_empty() {
        let mut without = name.clone();
        for inner in &kept_names {
            without = without.replace(inner, " ");
            for key in keys_of(inner) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        let (brackets, _, _, _) = regexes();
        let without = brackets.replace_all(&without, " ");
        for key in keys_of(&without) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    let main = fold::fold(&name);
    Title { keys, main, version, featured }
}

/// Artist names from one credit: "A, B & C", "A x B", "A feat. B", "A; B".
pub fn split_artists(value: &str) -> Vec<String> {
    static SPLIT: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let split = SPLIT.get_or_init(|| {
        Regex::new(
            r"(?i)\s*(?:,|;|/|\s&\s|\sx\s|\s×\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\swith\s|\svs\.?\s|\sand\s)\s*",
        )
        .unwrap()
    });
    split.split(&value.replace('\u{a0}', " ")).map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect()
}

/// The keys of each name, whole and split ("AC/DC" is one artist and reads as two).
fn artist_keys(artists: &[String]) -> HashSet<String> {
    artists
        .iter()
        .flat_map(|a| std::iter::once(a.clone()).chain(split_artists(a)))
        .flat_map(|a| keys_of(&a))
        .filter(|k| k.chars().count() > 1)
        .collect()
}

/// Edit-distance similarity, 0..1.
fn similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let substitution = previous + usize::from(ca != cb);
            previous = row[j + 1];
            row[j + 1] = substitution.min(row[j] + 1).min(row[j + 1] + 1);
        }
    }
    1.0 - row[b.len()] as f64 / a.len().max(b.len()) as f64
}

struct Indexed {
    candidate: Candidate,
    title: Title,
    artists: HashSet<String>,
}

pub struct Matcher {
    items: Vec<Indexed>,
    by_title: HashMap<String, Vec<usize>>,
    by_artist: HashMap<String, Vec<usize>>,
}

impl Matcher {
    pub fn new(candidates: Vec<Candidate>) -> Self {
        let mut items = Vec::with_capacity(candidates.len());
        let mut by_title: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_artist: HashMap<String, Vec<usize>> = HashMap::new();
        for candidate in candidates {
            let mut artists = candidate.artists.clone();
            let mut title_text = candidate.title.clone();
            // A file without tags is titled "Artist - Title" from its name.
            if artists.is_empty()
                && let Some((artist, title)) = candidate.title.split_once(" - ")
            {
                artists.push(artist.to_owned());
                title_text = title.to_owned();
            }
            let title = read_title(&title_text);
            let mut artist_set = artist_keys(&artists);
            artist_set.extend(artist_keys(&title.featured));
            let index = items.len();
            for key in &title.keys {
                by_title.entry(key.clone()).or_default().push(index);
            }
            for key in &artist_set {
                by_artist.entry(key.clone()).or_default().push(index);
            }
            items.push(Indexed { candidate, title, artists: artist_set });
        }
        for list in by_title.values_mut().chain(by_artist.values_mut()) {
            list.dedup();
        }
        Self { items, by_title, by_artist }
    }

    /// The library's song for a wanted track, if there is one.
    pub fn find(&self, wanted: &Wanted) -> Option<Found> {
        let title = read_title(&wanted.title);
        let mut artists = artist_keys(&wanted.artists);
        artists.extend(artist_keys(&title.featured));
        let length = |item: &Indexed| wanted.duration_ms.map(|d| d.abs_diff(item.candidate.duration_ms));

        let mut best: Option<(Confidence, u64, usize)> = None;
        let consider =
            |best: &mut Option<(Confidence, u64, usize)>, index: usize, confidence: Confidence, diff: u64| {
                if best.is_none_or(|(c, d, _)| (confidence, diff) < (c, d)) {
                    *best = Some((confidence, diff, index));
                }
            };

        let same_title: BTreeSet<usize> =
            title.keys.iter().filter_map(|k| self.by_title.get(k)).flatten().copied().collect();
        for &index in &same_title {
            let item = &self.items[index];
            if item.title.version != title.version {
                continue;
            }
            let shares_artist = !artists.is_disjoint(&item.artists);
            match (shares_artist, length(item)) {
                (true, None) => consider(&mut best, index, Confidence::Exact, 0),
                (true, Some(diff)) if diff <= SAME_LENGTH_MS => consider(&mut best, index, Confidence::Exact, diff),
                (true, Some(diff)) if diff <= NEAR_LENGTH_MS => consider(&mut best, index, Confidence::Likely, diff),
                // An untagged file with no artist to compare: the same length says it.
                (false, Some(diff)) if item.artists.is_empty() && diff <= SAME_LENGTH_MS => {
                    consider(&mut best, index, Confidence::Likely, diff)
                }
                _ => {}
            }
        }
        if best.is_none() {
            // The title spelled a little differently: the artist and the length must agree.
            let same_artist: BTreeSet<usize> =
                artists.iter().filter_map(|k| self.by_artist.get(k)).flatten().copied().collect();
            for &index in &same_artist {
                let item = &self.items[index];
                if item.title.version != title.version {
                    continue;
                }
                let Some(diff) = length(item) else { continue };
                if diff <= SAME_LENGTH_MS && similarity(&title.main, &item.title.main) >= NEAR_TITLE {
                    consider(&mut best, index, Confidence::Likely, diff);
                }
            }
        }
        best.map(|(confidence, _, index)| Found { song_id: self.items[index].candidate.song_id.clone(), confidence })
    }
}

/// Every present song of the library, one row per song (its first variant's tags).
pub fn library(db: &Db) -> Result<Vec<Candidate>> {
    let mut stmt = db.conn().prepare(
        "SELECT v.song_id, v.title, t.duration_ms,
                (SELECT group_concat(name, char(31)) FROM variant_artists a
                 WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY a.position),
                (SELECT group_concat(name, char(31)) FROM variant_artists a
                 WHERE a.variant_id = v.variant_id AND a.role = 'album_artist' ORDER BY a.position)
         FROM track_variants v JOIN tracks t ON t.song_id = v.song_id
         WHERE EXISTS (SELECT 1 FROM locations l WHERE l.variant_id = v.variant_id AND l.missing_since IS NULL)
         ORDER BY v.song_id, v.variant_id",
    )?;
    let split = |value: Option<String>| -> Vec<String> {
        value.map(|v| v.split('\u{1f}').map(str::to_owned).collect()).unwrap_or_default()
    };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })? {
        let (song_id, title, duration_ms, artists, album_artists) = row?;
        if !seen.insert(song_id.clone()) {
            continue;
        }
        let mut artists = split(artists);
        if artists.is_empty() {
            artists = split(album_artists);
        }
        out.push(Candidate { song_id, title, artists, duration_ms: duration_ms.max(0) as u64 });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(id: &str, title: &str, artists: &[&str], seconds: u64) -> Candidate {
        Candidate {
            song_id: id.into(),
            title: title.into(),
            artists: artists.iter().map(|a| (*a).to_owned()).collect(),
            duration_ms: seconds * 1000,
        }
    }

    fn wanted(title: &str, artists: &[&str], seconds: u64) -> Wanted {
        Wanted {
            title: title.into(),
            artists: artists.iter().map(|a| (*a).to_owned()).collect(),
            duration_ms: Some(seconds * 1000),
        }
    }

    fn library() -> Matcher {
        Matcher::new(vec![
            song("orig", "Fortuna", &["gunbaou", "LOSTOV"], 140),
            song("slow", "fortuna (slowed)", &["gunbaou", "LOSTOV"], 126),
            song("super", "Fortuna (Super Slowed)", &["gunbaou"], 160),
            song("hiraeth", "dread", &["hiræth"], 180),
            song("jp", "祈り、終われば", &["Mika Nakashima"], 250),
            song("cyr", "Бродяга", &["Кино"], 200),
            song("mushoku", "無職転生 (Jobless Reincarnation)", &["大原ゆい子"], 230),
            song("remix", "Lamp (Someone Remix)", &["Artist"], 300),
            song("lamp", "Lamp", &["Artist"], 400),
            song("untagged", "Zhnoi - r9k", &[], 150),
            song("styled", "ΔS†ΞЯ", &["Midbooze"], 210),
            song("intro", "Intro", &["Band One"], 60),
        ])
    }

    fn find(m: &Matcher, w: Wanted) -> Option<(String, Confidence)> {
        m.find(&w).map(|f| (f.song_id, f.confidence))
    }

    #[test]
    fn a_version_never_stands_in_for_another() {
        let m = library();
        assert_eq!(
            find(&m, wanted("fortuna - slowed", &["gunbaou", "LOSTOV"], 125)),
            Some(("slow".into(), Confidence::Exact))
        );
        assert_eq!(find(&m, wanted("Fortuna", &["gunbaou"], 141)), Some(("orig".into(), Confidence::Exact)));
        assert_eq!(find(&m, wanted("Fortuna - Super Slowed", &["gunbaou"], 160)).map(|f| f.0), Some("super".into()));
        // Sped up exists nowhere: no match, not the original.
        assert_eq!(find(&m, wanted("Fortuna - Sped Up", &["gunbaou"], 110)), None);
        assert_eq!(find(&m, wanted("Fortuna (slowed + reverb)", &["gunbaou"], 126)), None);
        // One remix is not the song, nor another remix.
        assert_eq!(find(&m, wanted("Lamp - Someone Remix", &["Artist"], 300)).map(|f| f.0), Some("remix".into()));
        assert_eq!(find(&m, wanted("Lamp - Other Remix", &["Artist"], 300)), None);
        assert_eq!(find(&m, wanted("Lamp", &["Artist"], 400)).map(|f| f.0), Some("lamp".into()));
    }

    #[test]
    fn spelling_script_and_credits_do_not_matter() {
        let m = library();
        assert_eq!(find(&m, wanted("Dread", &["hiraeth"], 181)).map(|f| f.0), Some("hiraeth".into()));
        assert_eq!(find(&m, wanted("Inori, Owareba", &["Mika Nakashima"], 250)).map(|f| f.0), Some("jp".into()));
        assert_eq!(find(&m, wanted("Brodyaga", &["Kino"], 199)).map(|f| f.0), Some("cyr".into()));
        assert_eq!(
            find(&m, wanted("Jobless Reincarnation", &["Yuiko Ohara", "大原ゆい子"], 230)).map(|f| f.0),
            Some("mushoku".into())
        );
        assert_eq!(find(&m, wanted("Aster", &["Midbooze"], 210)).map(|f| f.0), Some("styled".into()));
        // The featured artist in the title, the main one in the credit.
        assert_eq!(find(&m, wanted("Fortuna (feat. LOSTOV)", &["gunbaou"], 140)).map(|f| f.0), Some("orig".into()));
        assert_eq!(find(&m, wanted("Fortuna - Remastered 2011", &["gunbaou"], 140)).map(|f| f.0), Some("orig".into()));
        // An untagged file: its name says the artist.
        assert_eq!(find(&m, wanted("r9k", &["Zhnoi"], 150)).map(|f| f.0), Some("untagged".into()));
    }

    #[test]
    fn length_and_artist_decide_how_sure() {
        let m = library();
        assert_eq!(find(&m, wanted("Fortuna", &["gunbaou"], 147)), Some(("orig".into(), Confidence::Likely)));
        assert_eq!(find(&m, wanted("Fortuna", &["gunbaou"], 175)), None, "another length is another recording");
        assert_eq!(find(&m, wanted("Intro", &["Band Two"], 60)), None, "the same title by someone else");
        // A letter off: likely, by the artist and the length.
        assert_eq!(find(&m, wanted("Fortunaa", &["gunbaou"], 140)), Some(("orig".into(), Confidence::Likely)));
    }

    #[test]
    fn artists_split_every_way_services_write_them() {
        assert_eq!(split_artists("gunbaou,\u{a0}LOSTOV"), vec!["gunbaou", "LOSTOV"]);
        assert_eq!(split_artists("A & B feat. C"), vec!["A", "B", "C"]);
        assert_eq!(split_artists("A x B; C"), vec!["A", "B", "C"]);
        // Whole names count too.
        let m = Matcher::new(vec![song("acdc", "Back In Black", &["AC/DC"], 256)]);
        assert_eq!(find(&m, wanted("Back In Black", &["AC/DC"], 256)).map(|f| f.0), Some("acdc".into()));
        let m = Matcher::new(vec![
            song("mega", "Automotivo Dança (Mega Slowed)", &["KREZUS"], 151),
            song("plain", "Automotivo Dança", &["KREZUS"], 151),
        ]);
        assert_eq!(
            find(&m, wanted("Automotivo Dança - Mega Slowed", &["KREZUS"], 151)).map(|f| f.0),
            Some("mega".into())
        );
    }
}
