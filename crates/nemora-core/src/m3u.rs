//! Playlist files from anywhere, matched against this library: a port of android/base
//! `playlistImportResolver.ts`, checked against it by `tests/m3u_oracle.rs`.
//!
//! A playlist written by another player names files by paths that mean nothing here, so the path
//! is only the first and cheapest clue. Every entry is resolved by what survives a move: the file's
//! name, the folder it sits in, and the tags the player wrote next to it (`#EXTINF` artist, title,
//! length). Comparisons run on a compact key (letters and digits, case- and accent-folded), so the
//! mangling players do to names (`'` to space, cut-off names, track numbers, bitrates) vanishes.
//!
//! JavaScript regex semantics are kept: `\d` and `\b` are ASCII there even in Unicode mode, so they
//! are written out as `[0-9]` and ASCII word boundaries; lookaheads need `fancy-regex`.

use std::collections::HashMap;
use std::sync::LazyLock;

use fancy_regex::Regex;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// The line as written: a path, a `file://` URL or a bare name.
    pub location: String,
    /// The `#EXTINF` display text, usually "Artist - Title".
    pub extinf_title: Option<String>,
    /// The `#EXTINF` length in seconds, when positive.
    pub duration_sec: Option<f64>,
}

/// Some players write `#EXTINF` lengths in milliseconds; per file, the median decides.
const MS_MEDIAN_THRESHOLD: f64 = 3600.0;
const MIN_PREFIX: usize = 10;
const SAME_LENGTH_SEC: f64 = 3.0;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid pattern")
}

static EXTINF: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^#EXTINF:\s*(-?[0-9.]+)[^,]*,(.*)$"));
static BITRATE: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\s*[(\[]\s*[0-9]{2,4}\s*(?:k|kbps|kbit)?\s*[)\]]\s*$"));
static TRACK_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)^\s*(?:[a-d]?[0-9]{1,3})(?:\s*[-.)\]]\s*|\s+-\s+|\s+(?=[^0-9]))"));
static SEGMENT_SPLIT: LazyLock<Regex> = LazyLock::new(|| re(r"\s+[-–—]\s+"));
static SEGMENT_TRACK: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^(?:[a-d]?[0-9]{1,3})(?:\s*[.)\]]\s*|\s+)(?=\S)"));
const W: &str = "[A-Za-z0-9_]";
static ARTIST_SPLIT: LazyLock<Regex> = LazyLock::new(|| {
    re(&format!(
        r"(?i)\s*(?:,|&|;|/|(?<!{W})feat\.?|(?<!{W})ft\.?|(?<!{W})x(?!{W})|(?<!{W})vs\.?|(?<!{W})and(?!{W}))\s*"
    ))
});
static NON_ALNUM: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"[^\p{L}\p{N}]+").unwrap());
static MARKS: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"\p{M}").unwrap());
static FILE_URL: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^file://(localhost)?"));
static DRIVE: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^/[a-z]:/"));
static AUDIO_NAME: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\.[a-z0-9]{2,5}$"));

fn is_match(r: &Regex, s: &str) -> bool {
    r.is_match(s).unwrap_or(false)
}

fn replace(r: &Regex, s: &str, with: &str) -> String {
    r.replace(s, with).into_owned()
}

fn split<'a>(r: &Regex, s: &'a str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut last = 0;
    for m in r.find_iter(s).flatten() {
        out.push(&s[last..m.start()]);
        last = m.end();
    }
    out.push(&s[last..]);
    out
}

/// JavaScript's `parseFloat` on what the `#EXTINF` pattern captured (`-?[0-9.]+`): the longest
/// numeric prefix.
fn js_parse_float(s: &str) -> f64 {
    let bytes = s.as_bytes();
    let mut end = usize::from(bytes.first() == Some(&b'-'));
    let mut seen_dot = false;
    let mut seen_digit = false;
    while end < bytes.len() {
        match bytes[end] {
            b'0'..=b'9' => seen_digit = true,
            b'.' if !seen_dot => seen_dot = true,
            _ => break,
        }
        end += 1;
    }
    if !seen_digit {
        return f64::NAN;
    }
    s[..end].trim_end_matches('.').parse().unwrap_or(f64::NAN)
}

pub fn parse(text: &str) -> Vec<Entry> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut raw: Vec<(String, Option<String>, Option<f64>)> = Vec::new();
    let mut pending: Option<(Option<String>, Option<f64>)> = None;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = js_trim(line);
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.get(..8).is_some_and(|p| p.eq_ignore_ascii_case("#EXTINF:")) {
            pending = Some(match EXTINF.captures(trimmed).ok().flatten() {
                Some(c) => {
                    let title = js_trim(c.get(2).map_or("", |m| m.as_str()));
                    (
                        Some(title.to_owned()).filter(|t| !t.is_empty()),
                        Some(js_parse_float(c.get(1).map_or("", |m| m.as_str()))),
                    )
                }
                None => (None, None),
            });
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        let (title, duration) = pending.take().unwrap_or((None, None));
        raw.push((trimmed.to_owned(), title, duration));
    }
    let mut lengths: Vec<f64> = raw.iter().filter_map(|r| r.2).filter(|d| d.is_finite() && *d > 0.0).collect();
    lengths.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = if lengths.is_empty() { 0.0 } else { lengths[lengths.len() / 2] };
    let scale = if median > MS_MEDIAN_THRESHOLD { 1.0 / 1000.0 } else { 1.0 };
    raw.into_iter()
        .map(|(location, extinf_title, duration)| Entry {
            location,
            extinf_title,
            duration_sec: duration.filter(|d| d.is_finite() && *d > 0.0).map(|d| d * scale),
        })
        .collect()
}

/// JavaScript's `String.prototype.trim` (White_Space plus BOM).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Letters and digits only, lower-cased, accents folded: the unit of every comparison.
pub fn compact_key(value: &str) -> String {
    let lower = value.nfkc().collect::<String>().to_lowercase();
    let decomposed: String = lower.nfkd().collect();
    NON_ALNUM.replace_all(&MARKS.replace_all(&decomposed, ""), "").into_owned()
}

/// `decodeURIComponent`, or the input unchanged where JavaScript would throw.
fn safe_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = value.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
            match hex {
                Some(b) => {
                    out.push(b);
                    i += 3;
                    continue;
                }
                None => return value.to_owned(),
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_owned())
}

/// A playlist line as a plain path: `file://` URLs decoded, separators unified.
pub fn location_to_path(location: &str) -> String {
    let mut path = js_trim(location).to_owned();
    if path.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("file://")) {
        path = safe_decode(&replace(&FILE_URL, &path, ""));
        if is_match(&DRIVE, &path) {
            path = path[1..].to_owned();
        }
    }
    path.replace('\\', "/")
}

fn split_path(path: &str) -> Vec<&str> {
    path.split('/').filter(|p| !p.is_empty()).collect()
}

pub fn file_name_of(location: &str) -> String {
    split_path(&location_to_path(location)).last().map(|s| (*s).to_owned()).unwrap_or_default()
}

pub fn folder_name_of(location: &str) -> Option<String> {
    let path = location_to_path(location);
    let parts = split_path(&path);
    (parts.len() >= 2).then(|| parts[parts.len() - 2].to_owned())
}

/// Measured in UTF-16 units, as 1.x did.
fn strip_extension(name: &str) -> String {
    let units: Vec<u16> = name.encode_utf16().collect();
    match units.iter().rposition(|&u| u == u16::from(b'.')) {
        Some(dot) if dot > 0 && units.len() - dot <= 6 => String::from_utf16_lossy(&units[..dot]),
        _ => name.to_owned(),
    }
}

/// A file name without what players and rippers add around the song.
pub fn clean_file_stem(name: &str) -> String {
    let s = strip_extension(name).replace('_', " ");
    let s = replace(&BITRATE, &s, "");
    let s = replace(&TRACK_PREFIX, &s, "");
    js_trim(&s).to_owned()
}

fn segments_of(value: &str) -> Vec<String> {
    split(&SEGMENT_SPLIT, value)
        .into_iter()
        .map(|segment| {
            let trimmed = js_trim(segment);
            let untracked = replace(&SEGMENT_TRACK, trimmed, "");
            if untracked.is_empty() { trimmed.to_owned() } else { untracked }
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn artist_names_of(value: &str) -> Vec<String> {
    split(&ARTIST_SPLIT, value).into_iter().map(|n| js_trim(n).to_owned()).filter(|n| !n.is_empty()).collect()
}

/// The file name inside an Android document URI, when it carries one.
pub fn file_name_from_content_uri(uri: &str) -> Option<(String, Option<String>)> {
    let at = uri.rfind("/document/")?;
    let id = safe_decode(&uri[at + "/document/".len()..]);
    let path = match id.find(':') {
        Some(colon) => id[colon + 1..].to_owned(),
        None => id,
    };
    let path = path.replace('\\', "/");
    let parts = split_path(&path);
    let file = parts.last()?;
    if !is_match(&AUDIO_NAME, file) {
        return None;
    }
    Some(((*file).to_owned(), (parts.len() >= 2).then(|| parts[parts.len() - 2].to_owned())))
}

#[derive(Debug, Clone, PartialEq)]
pub struct LibraryTrack {
    pub song_id: String,
    pub path: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_sec: f64,
    /// The file's own name, when the path does not carry it (Android MediaStore).
    pub file_name: Option<String>,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Path,
    FileName,
    Tags,
    ArtistTitle,
    TitleLength,
    FileNameStart,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::FileName => "file-name",
            Self::Tags => "tags",
            Self::ArtistTitle => "artist-title",
            Self::TitleLength => "title-length",
            Self::FileNameStart => "file-name-start",
        }
    }
}

struct Indexed {
    track: LibraryTrack,
    file_keys: Vec<String>,
    folder_key: Option<String>,
    title_key: String,
    artist_keys: Vec<String>,
    composite_keys: Vec<String>,
}

fn unique(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

pub struct Resolver {
    items: Vec<Indexed>,
    by_path: HashMap<String, Vec<usize>>,
    by_file: HashMap<String, Vec<usize>>,
    by_title: HashMap<String, Vec<usize>>,
    by_composite: HashMap<String, Vec<usize>>,
}

fn path_key(path: &str) -> String {
    location_to_path(path).to_lowercase()
}

impl Resolver {
    pub fn new(tracks: Vec<LibraryTrack>) -> Self {
        let mut r = Resolver {
            items: Vec::new(),
            by_path: HashMap::new(),
            by_file: HashMap::new(),
            by_title: HashMap::new(),
            by_composite: HashMap::new(),
        };
        for track in tracks {
            let derived = if track.file_name.is_some() {
                Some((track.file_name.clone().unwrap(), track.folder_name.clone()))
            } else if track.path.starts_with("content://") {
                file_name_from_content_uri(&track.path)
            } else {
                Some((file_name_of(&track.path), folder_name_of(&track.path)))
            };
            let file_keys = match &derived {
                Some((f, _)) => unique(vec![compact_key(&strip_extension(f)), compact_key(&clean_file_stem(f))])
                    .into_iter()
                    .filter(|k| !k.is_empty())
                    .collect(),
                None => Vec::new(),
            };
            let title_key = compact_key(&track.title);
            let artist_keys: Vec<String> =
                track.artists.iter().map(|a| compact_key(a)).filter(|k| k.chars().count() > 1).collect();
            let all_artists = compact_key(&track.artists.concat());
            let mut composite = vec![format!("{all_artists}{title_key}"), format!("{title_key}{all_artists}")];
            for a in &artist_keys {
                composite.push(format!("{a}{title_key}"));
                composite.push(format!("{title_key}{a}"));
            }
            let title_len = title_key.encode_utf16().count();
            let composite_keys: Vec<String> =
                unique(composite).into_iter().filter(|k| k.encode_utf16().count() > title_len).collect();
            let index = r.items.len();
            r.by_path.entry(path_key(&track.path)).or_default().push(index);
            for k in &file_keys {
                r.by_file.entry(k.clone()).or_default().push(index);
            }
            if !title_key.is_empty() {
                r.by_title.entry(title_key.clone()).or_default().push(index);
            }
            for k in &composite_keys {
                r.by_composite.entry(k.clone()).or_default().push(index);
            }
            r.items.push(Indexed {
                folder_key: derived.and_then(|(_, folder)| folder).map(|f| compact_key(&f)),
                track,
                file_keys,
                title_key,
                artist_keys,
                composite_keys,
            });
        }
        r
    }

    fn artists_overlap(&self, item: &Indexed, credit: &str) -> bool {
        let credit_key = compact_key(credit);
        if credit_key.chars().count() < 2 {
            return false;
        }
        let names: Vec<String> =
            artist_names_of(credit).iter().map(|n| compact_key(n)).filter(|k| k.chars().count() > 1).collect();
        item.artist_keys.iter().any(|artist| {
            names.contains(artist)
                || (artist.encode_utf16().count() >= 4 && credit_key.contains(artist.as_str()))
                || credit_key == *artist
        })
    }

    fn length_diff(item: &Indexed, entry: &Entry) -> Option<f64> {
        match entry.duration_sec {
            Some(d) if item.track.duration_sec > 0.0 => Some((item.track.duration_sec - d).abs()),
            _ => None,
        }
    }

    /// One winner out of candidates of the same strength; copies of one recording are one answer,
    /// genuinely different songs are ambiguous.
    fn pick(&self, candidates: &[usize], entry: &Entry, folder_key: Option<&str>) -> Option<usize> {
        let mut unique_c: Vec<usize> = Vec::new();
        for &c in candidates {
            if !unique_c.contains(&c) {
                unique_c.push(c);
            }
        }
        if unique_c.is_empty() {
            return None;
        }
        let plausible: Vec<usize> = unique_c
            .iter()
            .copied()
            .filter(|&i| Self::length_diff(&self.items[i], entry).is_none_or(|d| d <= 20.0))
            .collect();
        let pool = if plausible.is_empty() { unique_c } else { plausible };
        if pool.len() == 1 {
            return Some(pool[0]);
        }
        let mut ranked = pool;
        ranked.sort_by(|&a, &b| {
            let (ia, ib) = (&self.items[a], &self.items[b]);
            let fa = i32::from(ia.folder_key.as_deref() == folder_key);
            let fb = i32::from(ib.folder_key.as_deref() == folder_key);
            (fb - fa).cmp(&0).then_with(|| {
                let da = Self::length_diff(ia, entry).unwrap_or(0.0);
                let db = Self::length_diff(ib, entry).unwrap_or(0.0);
                (da - db).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
            })
        });
        let best = &self.items[ranked[0]];
        let same_recording = ranked.iter().all(|&i| {
            let item = &self.items[i];
            item.title_key == best.title_key
                && (item.track.duration_sec - best.track.duration_sec).abs() <= SAME_LENGTH_SEC
        });
        if same_recording {
            return Some(ranked[0]);
        }
        let second = &self.items[ranked[1]];
        if let (Some(bd), Some(sd)) = (Self::length_diff(best, entry), Self::length_diff(second, entry))
            && bd <= SAME_LENGTH_SEC
            && sd > SAME_LENGTH_SEC
        {
            return Some(ranked[0]);
        }
        if folder_key.is_some()
            && best.folder_key.as_deref() == folder_key
            && second.folder_key.as_deref() != folder_key
        {
            return Some(ranked[0]);
        }
        None
    }

    /// The library song an entry names, and how it was found; `None` rather than a guess.
    pub fn resolve(&self, entry: &Entry) -> Option<(String, Method)> {
        let done = |i: Option<usize>, m: Method| i.map(|i| (self.items[i].track.song_id.clone(), m));
        let file_name = file_name_of(&entry.location);
        let folder_key = folder_name_of(&entry.location).map(|f| compact_key(&f));
        let folder = folder_key.as_deref();

        if let Some(hits) = self.by_path.get(&path_key(&entry.location))
            && let Some(found) = done(self.pick(hits, entry, folder), Method::Path)
        {
            return Some(found);
        }
        let stem_keys: Vec<String> =
            unique(vec![compact_key(&strip_extension(&file_name)), compact_key(&clean_file_stem(&file_name))])
                .into_iter()
                .filter(|k| !k.is_empty())
                .collect();
        for key in &stem_keys {
            if let Some(found) =
                done(self.pick(self.by_file.get(key).map_or(&[][..], Vec::as_slice), entry, folder), Method::FileName)
            {
                return Some(found);
            }
        }
        let sources: Vec<String> =
            unique(vec![entry.extinf_title.clone().unwrap_or_default(), clean_file_stem(&file_name)])
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect();
        for source in &sources {
            let segments = segments_of(source);
            if segments.is_empty() {
                continue;
            }
            let mut title_at = vec![segments.len() - 1];
            if !title_at.contains(&0) {
                title_at.push(0);
            }
            for index in title_at {
                let candidates = self.by_title.get(&compact_key(&segments[index])).map_or(&[][..], Vec::as_slice);
                if candidates.is_empty() {
                    continue;
                }
                let credit = segments
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != index)
                    .map(|(_, s)| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" - ");
                let credited: Vec<usize> =
                    candidates.iter().copied().filter(|&i| self.artists_overlap(&self.items[i], &credit)).collect();
                if let Some(found) = done(self.pick(&credited, entry, folder), Method::Tags) {
                    return Some(found);
                }
            }
            if let Some(found) = done(
                self.pick(self.by_composite.get(&compact_key(source)).map_or(&[][..], Vec::as_slice), entry, folder),
                Method::ArtistTitle,
            ) {
                return Some(found);
            }
        }
        if entry.duration_sec.is_some() {
            for source in &sources {
                let segments = segments_of(source);
                if segments.is_empty() {
                    continue;
                }
                let mut ends = vec![segments[segments.len() - 1].clone()];
                if !ends.contains(&segments[0]) {
                    ends.push(segments[0].clone());
                }
                for segment in ends {
                    let timed: Vec<usize> = self
                        .by_title
                        .get(&compact_key(&segment))
                        .into_iter()
                        .flatten()
                        .copied()
                        .filter(|&i| {
                            Self::length_diff(&self.items[i], entry).unwrap_or(f64::INFINITY) <= SAME_LENGTH_SEC
                        })
                        .collect();
                    if let Some(found) = done(self.pick(&timed, entry, folder), Method::TitleLength) {
                        return Some(found);
                    }
                }
            }
        }
        for key in &stem_keys {
            let key_len = key.encode_utf16().count();
            if key_len < MIN_PREFIX {
                continue;
            }
            let starts: Vec<usize> = (0..self.items.len())
                .filter(|&i| {
                    let item = &self.items[i];
                    item.file_keys.iter().any(|f| f.encode_utf16().count() > key_len && f.starts_with(key.as_str()))
                        || item
                            .composite_keys
                            .iter()
                            .any(|c| c.encode_utf16().count() > key_len && c.starts_with(key.as_str()))
                })
                .collect();
            if let Some(found) = done(self.pick(&starts, entry, folder), Method::FileNameStart) {
                return Some(found);
            }
        }
        None
    }
}

/// An M3U8 for the given tracks: `#EXTINF:<seconds>,<artists> - <title>` and the path.
pub fn write(tracks: &[(String, Vec<String>, i64, String)]) -> String {
    let mut out = String::from("#EXTM3U\n");
    for (title, artists, duration_ms, path) in tracks {
        let label = if artists.is_empty() { title.clone() } else { format!("{} - {title}", artists.join(", ")) };
        out.push_str(&format!("#EXTINF:{},{label}\n{path}\n", (duration_ms + 500) / 1000));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems_lose_what_players_add() {
        assert_eq!(clean_file_stem("05. Artist - Song (320).mp3"), "Artist - Song");
        assert_eq!(clean_file_stem("A2 Song_Name [128kbps].flac"), "Song Name");
        assert_eq!(clean_file_stem("1979.mp3"), "1979");
        assert_eq!(compact_key("Café Del Mar!"), "cafedelmar");
        assert_eq!(location_to_path("file:///C:/Music/a%20b.flac"), "C:/Music/a b.flac");
        assert_eq!(artist_names_of("A, B & C feat. D x E"), ["A", "B", "C", "D", "E"]);
        assert_eq!(artist_names_of("Xenia"), ["Xenia"]);
    }

    #[test]
    fn millisecond_lengths_are_detected() {
        let entries = parse("#EXTM3U\n#EXTINF:200000,A - B\na.mp3\n#EXTINF:180000,C - D\nc.mp3\n");
        assert_eq!(entries[0].duration_sec, Some(200.0));
        assert_eq!(entries[1].extinf_title.as_deref(), Some("C - D"));
    }
}
