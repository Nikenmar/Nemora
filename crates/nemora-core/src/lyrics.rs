//! Lyrics: one LRC text per song (or plain text), parsed into lines for display. The parser is a
//! port of 1.1.9 `common/parseLyrics.ts`, checked against it by `tests/lyrics_oracle.rs`: synced
//! lines, word-level ("enhanced") timing, translation lines (`[lang:xx]`), the offset and the
//! copyright tag.
//!
//! JavaScript regex semantics are kept: `\w` and `\d` are ASCII, `.` stops at line ends; lines are
//! split on `\n` with a trailing `\r` dropped, which is what JavaScript's `$` and `.` amounted to.

use std::sync::LazyLock;

use fancy_regex::Regex;
use serde::Serialize;

pub const INSTRUMENTAL: &str = "♪";

fn re(p: &str) -> Regex {
    Regex::new(p).expect("valid pattern")
}

const W: &str = "[A-Za-z0-9_]";
static LYRICS_LINE: LazyLock<Regex> = LazyLock::new(|| {
    re(&format!(
        r"^(?<timestamp>\[[0-9]+:[0-9]{{1,2}}\.[0-9]{{1,3}}\])?(\[(?:lang:)?(?<lang>{W}{{2,3}})\])?(?=(?<lyric>.+$))"
    ))
});
static SYNCED: LazyLock<Regex> = LazyLock::new(|| {
    re(&format!(
        r"^(\[(?:lang:)?(?<lang>{W}{{2,3}})\])?(?<timestamp>\[(?<sec>[0-9]+):(?<ms>[0-9]{{1,2}}\.[0-9]{{1,3}})\])(\[(?:lang:)?(?:{W}{{2,3}})\])?(?=(?<lyric>.+$))"
    ))
});
static EXTENDED_LINE: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?<ts>[\[<][0-9]+:[0-9]{1,2}\.[0-9]{1,3}[\]>]) ?(?=(?<lyric>[^<>\n]+))"));
static METADATA_LINE: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"^\[{W}+:.{{1,}}\]$")));
static LANG_TAG: LazyLock<Regex> = LazyLock::new(|| re(r"^\[lang:(?<lang>.+)\]$"));
static LINE_LANG_TAG: LazyLock<Regex> = LazyLock::new(|| re(r"\[lang:(?<lang>.+)\](.+)$"));
static COPYRIGHT: LazyLock<Regex> = LazyLock::new(|| re(r"^\[copyright:(?<c>.+)\]$"));
static OFFSET: LazyLock<Regex> = LazyLock::new(|| re(r"^\[offset:(?<o>[+-]?[0-9]+)\]$"));

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Word {
    pub text: String,
    #[serde(rename = "unparsedText")]
    pub unparsed_text: String,
    pub start: f64,
    /// Seconds; infinite for the last word of the last line (serialised as null).
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Text {
    Plain(String),
    Words(Vec<Word>),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Translation {
    pub lang: String,
    pub text: Text,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line {
    #[serde(rename = "originalText")]
    pub original: Text,
    #[serde(rename = "translatedTexts")]
    pub translations: Vec<Translation>,
    #[serde(rename = "isEnhancedSynced")]
    pub enhanced: bool,
    pub start: Option<f64>,
    /// Seconds; infinite for the last line.
    pub end: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Lyrics {
    #[serde(rename = "isSynced")]
    pub synced: bool,
    #[serde(rename = "isTranslated")]
    pub translated: bool,
    pub lines: Vec<Line>,
    pub copyright: Option<String>,
    #[serde(rename = "originalLanguage")]
    pub language: Option<String>,
    #[serde(rename = "translatedLanguages")]
    pub translated_languages: Vec<String>,
    /// Seconds.
    pub offset: f64,
}

fn lines_of(text: &str) -> impl Iterator<Item = &str> {
    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l))
}

fn first_capture(r: &Regex, text: &str, group: &str) -> Option<String> {
    lines_of(text)
        .find_map(|line| r.captures(line).ok().flatten().and_then(|c| c.name(group).map(|m| m.as_str().to_owned())))
}

fn is_match(r: &Regex, s: &str) -> bool {
    r.is_match(s).unwrap_or(false)
}

/// Whether any line is time-stamped.
pub fn is_synced(text: &str) -> bool {
    lines_of(text).any(|l| is_match(&SYNCED, l))
}

fn js_parse_int(s: &str) -> f64 {
    let digits: String = s.trim().chars().take_while(char::is_ascii_digit).collect();
    digits.parse().unwrap_or(f64::NAN)
}

fn js_parse_float(s: &str) -> f64 {
    let s = s.trim();
    let mut end = 0;
    let mut dot = false;
    for (i, c) in s.char_indices() {
        if c.is_ascii_digit() || (c == '.' && !dot) {
            dot |= c == '.';
            end = i + 1;
        } else {
            break;
        }
    }
    s[..end].trim_end_matches('.').parse().unwrap_or(f64::NAN)
}

fn seconds_of_line(line: &str) -> f64 {
    match SYNCED.captures(line).ok().flatten() {
        Some(c) => js_parse_int(&c["sec"]) * 60.0 + js_parse_float(&c["ms"]),
        None => 0.0,
    }
}

fn seconds_of_extended(ts: &str) -> f64 {
    let cleaned: String = ts.chars().filter(|c| !"<>[]".contains(*c)).collect();
    let mut parts = cleaned.split(':');
    let sec = parts.next().unwrap_or("");
    let ms = parts.next().unwrap_or("");
    js_parse_int(sec) * 60.0 + js_parse_float(ms)
}

fn end_of(lines: &[&str], index: usize) -> f64 {
    if index + 1 == lines.len() {
        return f64::INFINITY;
    }
    match lines.get(index + 1) {
        Some(next) if !next.is_empty() => seconds_of_line(next),
        _ => 0.0,
    }
}

fn words(line: &str, line_end: f64) -> Text {
    let matches: Vec<(String, String)> = EXTENDED_LINE
        .captures_iter(line)
        .filter_map(|c| c.ok())
        .map(|c| (c["ts"].to_owned(), c.name("lyric").map_or(String::new(), |m| m.as_str().to_owned())))
        .collect();
    if matches.is_empty() {
        return Text::Plain(line.to_owned());
    }
    let starts: Vec<f64> = matches.iter().map(|(ts, _)| seconds_of_extended(ts)).collect();
    Text::Words(
        matches
            .iter()
            .enumerate()
            .map(|(i, (ts, lyric))| Word {
                text: lyric.trim().to_owned(),
                unparsed_text: format!("{ts} {lyric}").trim().to_owned(),
                start: starts[i],
                end: if i + 1 == matches.len() { line_end } else { starts[i + 1] },
            })
            .collect(),
    )
}

fn line_text(line: &str, line_end: f64) -> Text {
    let text = SYNCED.replace(line, "").trim().to_owned();
    if is_match(&EXTENDED_LINE, &text) {
        return words(line, line_end);
    }
    Text::Plain(if text.is_empty() { INSTRUMENTAL.to_owned() } else { text })
}

struct Partial<'a> {
    input: &'a str,
    lang: Option<String>,
    lyric: String,
}

fn partial(line: &str) -> Option<Partial<'_>> {
    let c = LYRICS_LINE.captures(line).ok().flatten()?;
    Some(Partial {
        input: line,
        lang: c.name("lang").map(|m| m.as_str().to_owned()),
        lyric: c.name("lyric")?.as_str().to_owned(),
    })
}

/// `Number.prototype.toFixed(2)` for the grouping key: halves round up.
fn fixed2(x: f64) -> i64 {
    (x * 100.0 + 0.5).floor() as i64
}

/// Parses an LRC (or plain) text.
pub fn parse(text: &str) -> Lyrics {
    let synced = is_synced(text);
    let lines: Vec<&str> = lines_of(text).filter(|l| !l.trim().is_empty() && !is_match(&METADATA_LINE, l)).collect();
    let partials: Vec<Partial<'_>> = lines.iter().filter_map(|l| partial(l)).collect();

    // Group originals with their translation lines: by time when synced, else a line without a
    // language tag starts a group.
    let mut groups: Vec<Vec<&Partial<'_>>> = Vec::new();
    if synced {
        let mut keys: Vec<i64> = Vec::new();
        for p in &partials {
            let key = fixed2(seconds_of_line(p.input));
            match keys.iter().position(|k| *k == key) {
                Some(i) => groups[i].push(p),
                None => {
                    keys.push(key);
                    groups.push(vec![p]);
                }
            }
        }
    } else {
        for p in &partials {
            if p.lang.is_none() || groups.is_empty() {
                groups.push(Vec::new());
            }
            groups.last_mut().unwrap().push(p);
        }
    }

    let originals: Vec<&str> = groups.iter().map(|g| g[0].input).collect();
    let mut translated_languages: Vec<String> = Vec::new();
    let mut translated = false;
    let lines_out: Vec<Line> = groups
        .iter()
        .enumerate()
        .map(|(index, group)| {
            if synced {
                let original = line_text(group[0].input, end_of(&originals, index));
                let translation_inputs: Vec<&str> = group[1..].iter().map(|p| p.input).collect();
                let translations: Vec<Translation> = translation_inputs
                    .iter()
                    .enumerate()
                    .map(|(i, t)| Translation {
                        lang: first_capture(&LINE_LANG_TAG, t, "lang")
                            .map(|l| l.to_lowercase())
                            .unwrap_or_else(|| "en".into()),
                        text: line_text(t, end_of(&translation_inputs, i)),
                    })
                    .collect();
                translated |= !translations.is_empty();
                for t in &translations {
                    if !translated_languages.contains(&t.lang) {
                        translated_languages.push(t.lang.clone());
                    }
                }
                Line {
                    enhanced: matches!(original, Text::Words(_)),
                    original,
                    translations,
                    start: Some(seconds_of_line(group[0].input)),
                    end: Some(end_of(&originals, index)),
                }
            } else {
                let translations: Vec<Translation> = group[1..]
                    .iter()
                    .map(|p| {
                        let lang = p.lang.clone().unwrap_or_default();
                        if !translated_languages.contains(&lang) {
                            translated_languages.push(lang.clone());
                        }
                        Translation { lang, text: Text::Plain(p.lyric.trim().to_owned()) }
                    })
                    .collect();
                translated |= !translations.is_empty();
                Line {
                    original: Text::Plain(group[0].lyric.trim().to_owned()),
                    translations,
                    enhanced: false,
                    start: None,
                    end: None,
                }
            }
        })
        .collect();

    let mut language = first_capture(&LANG_TAG, text, "lang").map(|l| l.to_lowercase());
    if language.is_none() {
        language = detect_language(&lines_out);
    }
    Lyrics {
        synced,
        translated,
        lines: lines_out,
        copyright: first_capture(&COPYRIGHT, text, "c"),
        language,
        translated_languages,
        offset: first_capture(&OFFSET, text, "o").and_then(|o| o.parse::<f64>().ok()).unwrap_or(0.0) / 1000.0,
    }
}

/// Korean, Chinese or Japanese when that script makes up most of the text (1.x's thresholds; its
/// per-character tests used JavaScript libraries, so this is an equivalent, not a byte-for-byte port).
fn detect_language(lines: &[Line]) -> Option<String> {
    let text: String = lines
        .iter()
        .map(|l| match &l.original {
            Text::Plain(s) => s.clone(),
            Text::Words(w) => w.iter().map(|x| x.text.as_str()).collect(),
        })
        .collect();
    let total = text.encode_utf16().count().max(1) as f64;
    let count = |f: fn(char) -> bool, s: &str| s.chars().filter(|c| f(*c)).count() as f64;
    let kana = |c: char| ('\u{3040}'..='\u{30ff}').contains(&c);
    let han = |c: char| ('\u{4e00}'..='\u{9fff}').contains(&c) || ('\u{3400}'..='\u{4dbf}').contains(&c);
    let hangul = |c: char| ('\u{ac00}'..='\u{d7af}').contains(&c) || ('\u{1100}'..='\u{11ff}').contains(&c);
    let no_spaces: String = text.chars().filter(|c| *c != ' ').collect();
    let korean = count(hangul, &no_spaces) / no_spaces.encode_utf16().count().max(1) as f64;
    let japanese = (count(kana, &text) + count(han, &text)) / total;
    let chinese = count(han, &text) / total;
    if korean > 0.5 {
        Some("ko".into())
    } else if chinese > 0.0 && japanese > 0.0 {
        let has_kana = text.chars().any(kana);
        if !has_kana && chinese > 0.5 {
            Some("zh".into())
        } else if has_kana && japanese > 0.5 {
            Some("ja".into())
        } else {
            None
        }
    } else {
        None
    }
}

// ----- stored lyrics ----------------------------------------------------------------------------

/// Where a lyrics text came from (`spec/schema-v1.md`, `lyrics.source`).
pub const SOURCES: &[&str] = &["tags", "lrc_file", "lrclib", "musixmatch", "user"];

/// The stored lyrics of a song, as text.
pub fn stored(db: &crate::db::Db, song_id: &str) -> crate::Result<Option<(String, String)>> {
    Ok(rusqlite::OptionalExtension::optional(db.conn().query_row(
        "SELECT text, source FROM lyrics WHERE song_id = ?1",
        [song_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ))?)
}

/// Saves lyrics. A user's own edit is never replaced by a found text; a found text replaces a
/// found text only when it is synced and the stored one is not.
pub fn save(db: &crate::db::Db, song_id: &str, text: &str, source: &str) -> crate::Result<bool> {
    let user = source == "user";
    if !user {
        let current: Option<(i64, i64)> = rusqlite::OptionalExtension::optional(db.conn().query_row(
            "SELECT user_edited, synced FROM lyrics WHERE song_id = ?1",
            [song_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        if let Some((edited, synced)) = current
            && (edited == 1 || synced == 1 || !is_synced(text))
        {
            return Ok(false);
        }
    }
    let parsed = parse(text);
    db.conn().execute(
        "INSERT INTO lyrics (song_id, text, synced, source, language, user_edited, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(song_id) DO UPDATE SET text = excluded.text, synced = excluded.synced, source = excluded.source,
           language = excluded.language, user_edited = excluded.user_edited, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by",
        rusqlite::params![
            song_id,
            text,
            i64::from(parsed.synced),
            source,
            parsed.language,
            i64::from(user),
            crate::db::now_ms(),
            db.device_id()?
        ],
    )?;
    Ok(true)
}

// ----- where lyrics come from -------------------------------------------------------------------

/// `[mm:ss.cc]` for a time in milliseconds.
fn lrc_stamp(ms: u32) -> String {
    let centis = ms / 10;
    format!("[{:02}:{:02}.{:02}]", centis / 6000, (centis / 100) % 60, centis % 100)
}

/// A synchronised-text frame (ID3v2 SYLT, milliseconds) as LRC lines.
pub fn sylt_to_lrc(content: &[(u32, String)]) -> String {
    content.iter().map(|(ms, text)| format!("{}{}", lrc_stamp(*ms), text.trim())).collect::<Vec<_>>().join("\n")
}

/// The `.lrc` file next to a song: `song.flac.lrc`, then `song.lrc` (1.x's two names).
pub fn from_lrc_file(song_path: &std::path::Path) -> Option<String> {
    let mut with_ext = song_path.as_os_str().to_owned();
    with_ext.push(".lrc");
    [std::path::PathBuf::from(with_ext), song_path.with_extension("lrc")]
        .iter()
        .find_map(|p| std::fs::read_to_string(p).ok())
        .map(|text| text.trim_start_matches('\u{feff}').to_owned())
        .filter(|t| !t.trim().is_empty())
}

/// Lyrics embedded in the file: a synchronised SYLT frame (MP3) first, then plain lyrics of any
/// format.
pub fn from_tags(song_path: &std::path::Path) -> Option<String> {
    use lofty::config::ParseOptions;
    use lofty::file::TaggedFileExt;
    use lofty::id3::v2::{Frame, SynchronizedTextFrame, TimestampFormat};

    let is_mp3 = song_path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp3"));
    if is_mp3 && let Ok(file) = std::fs::File::open(song_path) {
        let mut reader = std::io::BufReader::new(file);
        if let Ok(mp3) = <lofty::mpeg::MpegFile as lofty::file::AudioFile>::read_from(&mut reader, ParseOptions::new())
            && let Some(tag) = mp3.id3v2()
        {
            // The last SYLT frame is the latest one written (1.x read them newest first).
            let synced = tag
                .into_iter()
                .filter_map(|frame| match frame {
                    Frame::Binary(binary) if binary.id().as_str() == "SYLT" => {
                        SynchronizedTextFrame::parse(&binary.data, frame.flags()).ok()
                    }
                    _ => None,
                })
                .rfind(|s| s.timestamp_format == TimestampFormat::MS && !s.content.is_empty());
            if let Some(sylt) = synced {
                return Some(sylt_to_lrc(&sylt.content));
            }
        }
    }
    let tagged = lofty::read_from_path(song_path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    tag.get_string(lofty::tag::ItemKey::Lyrics).map(str::to_owned).filter(|t| !t.trim().is_empty())
}

/// LRCLIB (https://lrclib.net), the open lyrics database 1.x used first.
pub mod lrclib {
    use serde::Deserialize;

    const BASE: &str = "https://lrclib.net/api";
    /// A track of this length is the same recording within this tolerance (search fallback).
    const SAME_LENGTH_SEC: f64 = 3.0;

    #[derive(Debug, Clone, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Record {
        pub track_name: Option<String>,
        pub artist_name: Option<String>,
        pub album_name: Option<String>,
        pub duration: Option<f64>,
        #[serde(default)]
        pub instrumental: bool,
        pub plain_lyrics: Option<String>,
        pub synced_lyrics: Option<String>,
    }

    /// The LRC text to store for a record: LRC metadata tags, then synced lyrics if any, else plain.
    pub fn to_lrc(record: &Record) -> Option<String> {
        let body = record
            .synced_lyrics
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| record.plain_lyrics.clone().filter(|s| !s.trim().is_empty()))?;
        let mut lines = Vec::new();
        if let Some(t) = &record.track_name {
            lines.push(format!("[ti:{t}]"));
        }
        if let Some(a) = &record.artist_name {
            lines.push(format!("[ar:{a}]"));
        }
        if let Some(a) = &record.album_name {
            lines.push(format!("[al:{a}]"));
        }
        lines.push("[copyright:Lyrics by LRCLIB (https://lrclib.net)]".to_owned());
        lines.push(body);
        Some(lines.join("\n"))
    }

    /// From a search answer: synced over plain, then the closest length within tolerance.
    pub fn best_of(records: &[Record], duration_sec: f64) -> Option<&Record> {
        records
            .iter()
            .filter(|r| r.duration.is_none_or(|d| (d - duration_sec).abs() <= SAME_LENGTH_SEC))
            .filter(|r| r.synced_lyrics.is_some() || r.plain_lyrics.is_some())
            .min_by(|a, b| {
                let synced = |r: &Record| u8::from(r.synced_lyrics.as_deref().is_none_or(|s| s.trim().is_empty()));
                synced(a).cmp(&synced(b)).then_with(|| {
                    let diff = |r: &Record| r.duration.map_or(f64::MAX, |d| (d - duration_sec).abs());
                    diff(a).partial_cmp(&diff(b)).unwrap_or(std::cmp::Ordering::Equal)
                })
            })
    }

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(10)))
            .user_agent(concat!("Nemora ", env!("CARGO_PKG_VERSION"), " (https://github.com/Nikenmar/Nemora)"))
            .build()
            .into()
    }

    /// Exact lookup, then a search; `Ok(None)` when LRCLIB knows no lyrics for the track.
    pub fn fetch(title: &str, artist: &str, album: Option<&str>, duration_sec: f64) -> Result<Option<String>, String> {
        let agent = agent();
        let mut request = agent
            .get(&format!("{BASE}/get"))
            .query("track_name", title)
            .query("artist_name", artist)
            .query("duration", (duration_sec.round() as i64).to_string());
        if let Some(album) = album {
            request = request.query("album_name", album);
        }
        match request.call() {
            Ok(mut response) => {
                let record: Record = response.body_mut().read_json().map_err(|e| e.to_string())?;
                if let Some(text) = to_lrc(&record) {
                    return Ok(Some(text));
                }
            }
            Err(ureq::Error::StatusCode(404)) => {}
            Err(e) => return Err(e.to_string()),
        }
        let mut response = agent
            .get(&format!("{BASE}/search"))
            .query("track_name", title)
            .query("artist_name", artist)
            .call()
            .map_err(|e| e.to_string())?;
        let records: Vec<Record> = response.body_mut().read_json().map_err(|e| e.to_string())?;
        Ok(best_of(&records, duration_sec).and_then(to_lrc))
    }
}

/// The lyrics of a song: stored ones, else the `.lrc` file next to it, else its tags, else (when
/// `network` is allowed) LRCLIB. Whatever is found is stored with its source.
pub fn get(db: &crate::db::Db, song_id: &str, network: bool) -> crate::Result<Option<(Lyrics, String)>> {
    if let Some((text, source)) = stored(db, song_id)? {
        return Ok(Some((parse(&text), source)));
    }
    let location: Option<(String, String, Option<String>, i64, Option<String>)> = rusqlite::OptionalExtension::optional(db.conn().query_row(
        "SELECT l.uri, v.title, v.album, t.duration_ms,
                (SELECT name FROM variant_artists a WHERE a.variant_id = v.variant_id AND a.role = 'artist' ORDER BY position LIMIT 1)
         FROM locations l JOIN track_variants v USING (variant_id) JOIN tracks t ON t.song_id = v.song_id
         WHERE v.song_id = ?1 AND l.missing_since IS NULL ORDER BY l.uri LIMIT 1",
        [song_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ))?;
    let Some((uri, title, album, duration_ms, artist)) = location else { return Ok(None) };
    let path = std::path::Path::new(&uri);
    let found =
        from_lrc_file(path).map(|t| (t, "lrc_file")).or_else(|| from_tags(path).map(|t| (t, "tags"))).or_else(|| {
            if !network {
                return None;
            }
            lrclib::fetch(&title, artist.as_deref().unwrap_or(""), album.as_deref(), duration_ms as f64 / 1000.0)
                .ok()
                .flatten()
                .map(|t| (t, "lrclib"))
        });
    match found {
        Some((text, source)) => {
            save(db, song_id, &text, source)?;
            Ok(Some((parse(&text), source.to_owned())))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synced_lines_carry_their_times() {
        let l = parse("[ti:x]\n[00:01.00]one\n[00:02.50]two\n");
        assert!(l.synced);
        assert_eq!(l.lines.len(), 2);
        assert_eq!(l.lines[0].start, Some(1.0));
        assert_eq!(l.lines[0].end, Some(2.5));
        assert_eq!(l.lines[1].end, Some(f64::INFINITY));
    }

    #[test]
    fn plain_text_is_one_line_per_line() {
        let l = parse("first\nsecond\n");
        assert!(!l.synced);
        assert_eq!(l.lines.len(), 2);
        assert_eq!(l.lines[1].original, Text::Plain("second".into()));
    }

    #[test]
    fn sylt_becomes_lrc() {
        assert_eq!(
            sylt_to_lrc(&[(1000, "one".into()), (62_345, " two ".into())]),
            "[00:01.00]one
[01:02.34]two"
        );
    }

    #[test]
    fn lrclib_prefers_synced_and_the_closest_length() {
        let json = r#"[
            {"trackName":"A","artistName":"X","albumName":null,"duration":200,"instrumental":false,"plainLyrics":"plain","syncedLyrics":null},
            {"trackName":"A","artistName":"X","albumName":"B","duration":202,"instrumental":false,"plainLyrics":"p","syncedLyrics":"[00:01.00]s"},
            {"trackName":"A","artistName":"X","albumName":"C","duration":260,"instrumental":false,"plainLyrics":"p","syncedLyrics":"[00:01.00]far"}
        ]"#;
        let records: Vec<lrclib::Record> = serde_json::from_str(json).unwrap();
        let best = lrclib::best_of(&records, 200.0).unwrap();
        assert_eq!(best.album_name.as_deref(), Some("B"));
        let lrc = lrclib::to_lrc(best).unwrap();
        assert!(lrc.starts_with(
            "[ti:A]
[ar:X]
[al:B]
[copyright:"
        ));
        assert!(parse(&lrc).synced);
    }

    #[test]
    fn user_edits_are_never_overwritten() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let s = "s".repeat(26);
        db.conn().execute("INSERT INTO tracks VALUES (?1, 'flac', 44100, 16, 2, 1, NULL, 0, 0)", [&s]).unwrap();
        assert!(save(&db, &s, "plain words", "tags").unwrap());
        assert!(!save(&db, &s, "other plain words", "lrclib").unwrap(), "plain does not replace plain");
        assert!(save(&db, &s, "[00:01.00]synced", "lrclib").unwrap(), "synced replaces plain");
        assert!(save(&db, &s, "my own", "user").unwrap());
        assert!(!save(&db, &s, "[00:01.00]found again", "lrclib").unwrap());
        assert_eq!(stored(&db, &s).unwrap().unwrap(), ("my own".to_owned(), "user".to_owned()));
    }
}
