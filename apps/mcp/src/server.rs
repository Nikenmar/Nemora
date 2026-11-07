//! The MCP server: the read tools of PLAN/22 P22.1, the docs as resources, the instructions.
//!
//! Every call opens the profile's database read-only (`Db::open_read_only`): the running app is
//! never blocked or written to, and a closed app is no obstacle. Errors come back as tool errors
//! (`isError`), with words the agent can act on.

use std::collections::HashMap;
use std::path::PathBuf;

use nemora_core::db::Db;
use nemora_core::library::{self, NameSort, SongRow, SongScope, SongSort};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::model::{
    Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse,
    ReadResourceResult, Resource, ResourceContents, ServerCapabilities, ServerConfig,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::docs;

#[derive(Clone)]
pub struct Nemora {
    profile: PathBuf,
    tool_router: ToolRouter<Self>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ----- shapes the agent sees -----------------------------------------------------------------

/// A song as a list shows it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    /// The recording's id: use it with the other tools.
    song_id: String,
    /// This row's own id when it is one file of several (`song:variant`) or a version (`song:v<n>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    view_id: Option<String>,
    title: String,
    artists: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<i64>,
    duration_seconds: f64,
    /// Plays that counted, all time.
    plays: i64,
    favorite: bool,
    /// The version's name when the row is a version (Slowed, + Reverb).
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

pub(crate) fn song(row: &SongRow) -> Song {
    let view_id = match &row.version {
        Some(v) => Some(format!("{}:v{}", row.song_id, v.id)),
        None if !row.is_primary => Some(format!("{}:{}", row.song_id, row.variant_id)),
        None => None,
    };
    Song {
        song_id: row.song_id.clone(),
        view_id,
        title: row.title.clone(),
        artists: row.artists.clone(),
        album: row.album.clone(),
        year: row.year,
        duration_seconds: (row.duration_ms as f64 / 100.0).round() / 10.0,
        plays: row.plays,
        favorite: row.is_favorite,
        version: row.version.as_ref().map(|v| v.name.clone()),
    }
}

/// The song id in a song id or a view id.
fn song_of(id: &str) -> &str {
    id.split(':').next().unwrap_or(id).trim()
}

pub(crate) fn rows_for_songs(db: &Db, song_ids: &[String]) -> Result<Vec<SongRow>, String> {
    let variants = library::primary_variants(db, song_ids).map_err(err)?;
    let ids: Vec<i64> = song_ids.iter().filter_map(|s| variants.get(s).copied()).collect();
    let rows = library::rows_by_id(db, &ids).map_err(err)?;
    // In the order asked for.
    let by_song: HashMap<&str, &SongRow> = rows.iter().map(|r| (r.song_id.as_str(), r)).collect();
    Ok(song_ids.iter().filter_map(|s| by_song.get(s.as_str()).map(|r| (*r).clone())).collect())
}

// ----- parameters ------------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchFilter {
    All,
    Songs,
    Artists,
    Albums,
    Genres,
    Playlists,
    /// Lines of lyrics: finds the songs whose lyrics hold the words.
    Lyrics,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchParams {
    /// What to look for: a title, an artist, an album, words of a lyric. Spelling mistakes,
    /// another keyboard layout, Cyrillic or a Japanese reading in Latin letters are fine.
    query: String,
    /// What kind of thing to find; `all` by default.
    #[serde(default)]
    filter: Option<SearchFilter>,
    /// At most this many songs (default 20, at most 100).
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchOut {
    songs: Vec<Song>,
    artists: Vec<String>,
    /// Album keys (`list_songs` takes them as an album scope) with their titles.
    albums: Vec<AlbumRef>,
    genres: Vec<String>,
    playlists: Vec<String>,
    /// Lyric lines that matched, with the song.
    lyrics: Vec<LyricHit>,
    /// When the songs matched only with typos: the spelling they matched.
    #[serde(skip_serializing_if = "Option::is_none")]
    did_you_mean: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlbumRef {
    key: String,
    title: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LyricHit {
    song: Song,
    line: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    seconds: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SongParams {
    /// A song id or a view id from another tool.
    song_id: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SongDetail {
    song: Song,
    /// The file the song plays from.
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    track_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disc_number: Option<i64>,
    /// When it was added (ISO 8601, UTC).
    added_at: String,
    stats: SongStats,
    /// Its versions (another sound, a row of their own).
    versions: Vec<VersionOut>,
    /// Its own sound (Switch version), if it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    switched_sound: Option<String>,
    has_lyrics: bool,
    /// What the file says beyond the library's row.
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<FileOut>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SongStats {
    plays: i64,
    full_listens: i64,
    skips: i64,
    listened_minutes: f64,
    /// Local days it was played on, with plays that day; the latest 30.
    recent_days: Vec<DayPlays>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_played: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_played: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DayPlays {
    day: String,
    plays: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VersionOut {
    view_id: String,
    name: String,
    semitones: f64,
    reverb: f64,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileOut {
    format: Option<String>,
    sample_rate: Option<i64>,
    bit_depth: Option<i64>,
    bitrate_kbps: Option<i64>,
    channels: Option<i64>,
    size_megabytes: f64,
    publisher: Option<String>,
    composer: Option<String>,
    copyright: Option<String>,
    isrc: Option<String>,
    bpm: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    Title,
    Artist,
    Album,
    Year,
    /// Disc and track number: an album's own order.
    Track,
    /// Newest added first.
    Added,
    /// Most played first.
    Plays,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListSongsParams {
    /// Which songs: leave out for all; or one of `favorites`, `album:<album key>`,
    /// `artist:<name>`, `genre:<name>`.
    #[serde(default)]
    scope: Option<String>,
    /// The order; `title` by default (`track` for an album).
    #[serde(default)]
    sort: Option<Sort>,
    /// Reversed order.
    #[serde(default)]
    descending: Option<bool>,
    /// Rows to skip, for paging.
    #[serde(default)]
    offset: Option<i64>,
    /// Rows to return (default 50, at most 200).
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SongPage {
    /// Rows in the whole list.
    total: i64,
    songs: Vec<Song>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NameOrder {
    Name,
    /// Most songs first.
    Songs,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListNamesParams {
    /// `name` (A to Z, default) or `songs` (most songs first).
    #[serde(default)]
    sort: Option<NameOrder>,
    /// Rows to skip, for paging.
    #[serde(default)]
    offset: Option<i64>,
    /// Default 100, at most 500.
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlbumOut {
    /// Use as `album:<key>` in `list_songs`.
    key: String,
    title: String,
    artists: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<i64>,
    song_count: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AlbumPage {
    total: i64,
    albums: Vec<AlbumOut>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NamedOut {
    name: String,
    song_count: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct NamedPage {
    total: i64,
    items: Vec<NamedOut>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistOut {
    playlist_id: String,
    name: String,
    song_count: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct Playlists {
    playlists: Vec<PlaylistOut>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlaylistParams {
    /// From `list_playlists`; `Favorites` is the favourites.
    playlist_id: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    playlist_id: String,
    name: String,
    songs: Vec<Song>,
    /// Entries whose file is gone or was never found (an imported title).
    missing: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RangeParam {
    AllTime,
    #[serde(rename = "last_30_days")]
    Last30Days,
    #[serde(rename = "last_12_months")]
    Last12Months,
    /// A calendar year: give `year`.
    Year,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DashboardParams {
    /// The period; `last_30_days` by default.
    #[serde(default)]
    range: Option<RangeParam>,
    /// With `range: year`.
    #[serde(default)]
    year: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    period: String,
    distinct_songs: i64,
    plays: i64,
    full_listens: i64,
    skips: i64,
    listening_hours: f64,
    favorites: i64,
    top_songs: Vec<TopSong>,
    top_artists: Vec<Named>,
    top_albums: Vec<Named>,
    top_genres: Vec<Named>,
    most_skipped: Vec<TopSong>,
    /// Plays per local hour, 0 to 23.
    hours: Vec<i64>,
    /// Plays per weekday, Monday first.
    weekdays: Vec<i64>,
    current_streak_days: i64,
    longest_streak_days: i64,
    /// Years with plays, newest first.
    years_with_plays: Vec<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TopSong {
    song_id: String,
    title: String,
    artists: Vec<String>,
    plays: i64,
    skips: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct Named {
    name: String,
    plays: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct HistoryParams {
    /// At most this many songs, latest first (default 30, at most 200).
    #[serde(default)]
    limit: Option<i64>,
    /// Only plays in the last this many days.
    #[serde(default)]
    days: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct History {
    songs: Vec<Song>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LyricsOut {
    song_id: String,
    /// Lines with `[mm:ss.xx]` times.
    synced: bool,
    /// Where they came from: tags, lrc_file, lrclib, musixmatch, user.
    source: String,
    /// The lyrics as stored (LRC when synced).
    text: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    songs: i64,
    albums: i64,
    artists: i64,
    genres: i64,
    playlists: i64,
    total_hours: f64,
    plays_all_time: i64,
    songs_with_lyrics: i64,
    /// The profile folder read.
    profile: String,
}

// ----- the tools -------------------------------------------------------------------------------

impl Nemora {
    pub fn new(profile: PathBuf) -> Self {
        Self { profile, tool_router: crate::control::router() }
    }

    pub(crate) fn db(&self) -> Result<Db, String> {
        let path = crate::profile::database(&self.profile);
        if !path.exists() {
            return Err(format!(
                "No Nemora library at {}. Is Nemora installed and has it been opened once?",
                path.display()
            ));
        }
        Db::open_read_only(&path).map_err(|e| format!("The library could not be opened: {e}"))
    }

    fn summary(&self) -> Result<Summary, String> {
        let db = self.db()?;
        let counts = library::counts(&db).map_err(err)?;
        Ok(Summary {
            songs: counts.songs,
            albums: library::albums(&db, NameSort::NameAsc).map_err(err)?.len() as i64,
            artists: library::artists(&db, NameSort::NameAsc).map_err(err)?.len() as i64,
            genres: library::genres(&db, NameSort::NameAsc).map_err(err)?.len() as i64,
            playlists: nemora_core::playlists::list(&db).map_err(err)?.len() as i64 + 1,
            total_hours: (counts.duration_ms as f64 / 360_000.0).round() / 10.0,
            plays_all_time: counts.plays,
            songs_with_lyrics: counts.songs_with_lyrics,
            profile: self.profile.display().to_string(),
        })
    }
}

#[tool_router(router = read_router, vis = "pub(crate)")]
impl Nemora {
    #[tool(
        description = "The library at a glance: how many songs, albums, artists, genres and playlists, the total length, all-time plays, and which profile folder is read. Call it first to see that Nemora's library is there.",
        annotations(title = "Library summary", read_only_hint = true, open_world_hint = false)
    )]
    fn library_summary(&self) -> Result<Json<Summary>, String> {
        Ok(Json(self.summary()?))
    }

    #[tool(
        description = "Search the library the way Nemora's search box does: titles, artists, albums, genres, playlists, and with filter `lyrics` the words of lyrics. Typos, another keyboard layout, Cyrillic and Latin readings of Japanese are handled. Returns songs (with ids for other tools), names, album keys, matching lyric lines, and `didYouMean` when only typo matches were found. Example: {\"query\": \"mushoku tensei\"}; {\"query\": \"rain on the window\", \"filter\": \"lyrics\"}.",
        annotations(title = "Search", read_only_hint = true, open_world_hint = false)
    )]
    fn search(&self, Parameters(p): Parameters<SearchParams>) -> Result<Json<SearchOut>, String> {
        let db = self.db()?;
        let limit = p.limit.unwrap_or(20).clamp(1, 100) as usize;
        let mut out = SearchOut {
            songs: Vec::new(),
            artists: Vec::new(),
            albums: Vec::new(),
            genres: Vec::new(),
            playlists: Vec::new(),
            lyrics: Vec::new(),
            did_you_mean: None,
        };
        let filter = p.filter.unwrap_or(SearchFilter::All);
        if matches!(filter, SearchFilter::Lyrics) {
            let hits = nemora_core::lyrics_index::search(&db, &p.query, limit).map_err(err)?;
            let ids: Vec<String> = hits.iter().map(|h| h.song_id.clone()).collect();
            let rows = rows_for_songs(&db, &ids)?;
            let by: HashMap<&str, &SongRow> = rows.iter().map(|r| (r.song_id.as_str(), r)).collect();
            out.lyrics = hits
                .iter()
                .filter_map(|h| {
                    by.get(h.song_id.as_str()).map(|r| LyricHit {
                        song: song(r),
                        line: h.text.clone(),
                        seconds: h.start,
                    })
                })
                .collect();
            return Ok(Json(out));
        }
        let core_filter = match filter {
            SearchFilter::All | SearchFilter::Lyrics => nemora_core::search::Filter::All,
            SearchFilter::Songs => nemora_core::search::Filter::Songs,
            SearchFilter::Artists => nemora_core::search::Filter::Artists,
            SearchFilter::Albums => nemora_core::search::Filter::Albums,
            SearchFilter::Genres => nemora_core::search::Filter::Genres,
            SearchFilter::Playlists => nemora_core::search::Filter::Playlists,
        };
        let corpus = library::search_corpus(&db).map_err(err)?;
        let found = nemora_core::search::search(&corpus, core_filter, &p.query);
        let variants: Vec<i64> = found.songs.iter().filter_map(|id| id.parse().ok()).take(limit).collect();
        out.songs = library::rows_by_id(&db, &variants).map_err(err)?.iter().map(song).collect();
        out.artists = found.artists.into_iter().take(limit).collect();
        let albums = library::albums(&db, NameSort::NameAsc).map_err(err)?;
        let titles: HashMap<&str, &str> = albums.iter().map(|a| (a.key.as_str(), a.title.as_str())).collect();
        out.albums = found
            .albums
            .iter()
            .take(limit)
            .map(|key| AlbumRef {
                key: key.clone(),
                title: titles.get(key.as_str()).map_or_else(|| key.clone(), |t| (*t).to_owned()),
            })
            .collect();
        out.genres = found.genres.into_iter().take(limit).collect();
        let playlists = nemora_core::playlists::list(&db).map_err(err)?;
        let names: HashMap<&str, &str> = playlists.iter().map(|p| (p.id.as_str(), p.name.as_str())).collect();
        out.playlists = found
            .playlists
            .iter()
            .take(limit)
            .map(|id| names.get(id.as_str()).map_or_else(|| id.clone(), |n| (*n).to_owned()))
            .collect();
        out.did_you_mean = found.did_you_mean;
        Ok(Json(out))
    }

    #[tool(
        description = "Everything about one song: its row (title, artists, album, year, length, plays, favourite), the file it plays from, track and disc numbers, when it was added, its statistics (plays, full listens, skips, minutes listened, the last 30 days it was played, first and last play), its versions, its Switch version sound, whether it has lyrics, and what its file says (format, sample rate, bit depth, bitrate, size, publisher, composer, copyright, ISRC, BPM). Takes a song id or a view id.",
        annotations(title = "Get a song", read_only_hint = true, open_world_hint = false)
    )]
    fn get_song(&self, Parameters(p): Parameters<SongParams>) -> Result<Json<SongDetail>, String> {
        let db = self.db()?;
        let id = song_of(&p.song_id).to_owned();
        let row = rows_for_songs(&db, std::slice::from_ref(&id))?
            .into_iter()
            .next()
            .ok_or_else(|| format!("No present song with id {id}. Find it with `search` first."))?;
        let totals = nemora_core::stats::song_totals(&db, &id).map_err(err)?;
        let days = nemora_core::stats::song_days(&db, &id).map_err(err)?;
        let versions = nemora_core::versions::by_song(&db).map_err(err)?.remove(&id).unwrap_or_default();
        let switched = nemora_core::song_sound::all(&db)
            .map_err(err)?
            .into_iter()
            .find(|(s, _)| *s == id)
            .map(|(_, sound)| nemora_core::song_sound::encode(&sound));
        let has_lyrics = nemora_core::lyrics::stored(&db, &id).map_err(err)?.is_some();
        let file = row.path.as_deref().and_then(|path| {
            let d = nemora_core::tags::read_details(std::path::Path::new(path)).ok()?;
            Some(FileOut {
                format: std::path::Path::new(path).extension().map(|e| e.to_string_lossy().to_uppercase()),
                sample_rate: d.sample_rate.map(i64::from),
                bit_depth: d.bit_depth.map(i64::from),
                bitrate_kbps: d.bitrate_kbps.map(i64::from),
                channels: d.channels.map(i64::from),
                size_megabytes: (d.size_bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0,
                publisher: d.publisher,
                composer: d.composer,
                copyright: d.copyright,
                isrc: d.isrc,
                bpm: d.bpm,
            })
        });
        let mut recent: Vec<DayPlays> =
            days.iter().map(|(day, plays)| DayPlays { day: day.clone(), plays: *plays }).collect();
        recent.sort_by(|a, b| b.day.cmp(&a.day));
        let first_played = days.iter().map(|(d, _)| d.clone()).min();
        let last_played = days.iter().map(|(d, _)| d.clone()).max();
        recent.truncate(30);
        Ok(Json(SongDetail {
            path: row.path.clone(),
            track_number: row.track_no,
            disc_number: row.disc_no,
            added_at: nemora_core::time::iso_ms(row.added_at),
            stats: SongStats {
                plays: totals.plays,
                full_listens: totals.full,
                skips: totals.skips,
                listened_minutes: (totals.heard_ms as f64 / 6000.0).round() / 10.0,
                recent_days: recent,
                first_played,
                last_played,
            },
            versions: versions
                .iter()
                .map(|v| VersionOut {
                    view_id: format!("{id}:v{}", v.id),
                    name: v.name.clone(),
                    semitones: v.semitones,
                    reverb: v.reverb,
                })
                .collect(),
            switched_sound: switched,
            has_lyrics,
            file,
            song: song(&row),
        }))
    }

    #[tool(
        description = "A page of songs, in an order: all of them, the favourites, one album, one artist or one genre. Scope examples: \"favorites\", \"artist:Nujabes\", \"genre:Electro\", \"album:<key from list_albums or search>\". Sorts: title, artist, album, year, track (an album's order), added (newest first), plays (most played first); `descending` reverses. Returns the list's total and the rows.",
        annotations(title = "List songs", read_only_hint = true, open_world_hint = false)
    )]
    fn list_songs(&self, Parameters(p): Parameters<ListSongsParams>) -> Result<Json<SongPage>, String> {
        let db = self.db()?;
        let scope = match p.scope.as_deref().map(str::trim) {
            None | Some("") | Some("all") => SongScope::NotBlacklisted,
            Some("favorites") | Some("favourites") => SongScope::Favorites,
            Some(s) if s.starts_with("album:") => SongScope::Album(s["album:".len()..].to_owned()),
            Some(s) if s.starts_with("artist:") => SongScope::Artist(s["artist:".len()..].to_owned()),
            Some(s) if s.starts_with("genre:") => SongScope::Genre(s["genre:".len()..].to_owned()),
            Some(other) => {
                return Err(format!(
                    "Unknown scope `{other}`: use favorites, album:<key>, artist:<name> or genre:<name>."
                ));
            }
        };
        let desc = p.descending.unwrap_or(false);
        let sort = match (p.sort, &scope) {
            (None, SongScope::Album(_)) => SongSort::TrackAsc,
            (None, _) => SongSort::TitleAsc,
            (Some(Sort::Title), _) => {
                if desc {
                    SongSort::TitleDesc
                } else {
                    SongSort::TitleAsc
                }
            }
            (Some(Sort::Artist), _) => {
                if desc {
                    SongSort::ArtistDesc
                } else {
                    SongSort::ArtistAsc
                }
            }
            (Some(Sort::Album), _) => {
                if desc {
                    SongSort::AlbumDesc
                } else {
                    SongSort::AlbumAsc
                }
            }
            (Some(Sort::Year), _) => {
                if desc {
                    SongSort::YearAsc
                } else {
                    SongSort::YearDesc
                }
            }
            (Some(Sort::Track), _) => {
                if desc {
                    SongSort::TrackDesc
                } else {
                    SongSort::TrackAsc
                }
            }
            (Some(Sort::Added), _) => {
                if desc {
                    SongSort::AddedAsc
                } else {
                    SongSort::AddedDesc
                }
            }
            (Some(Sort::Plays), _) => SongSort::PlaysDesc,
        };
        let page =
            library::songs(&db, &scope, &sort, p.offset.unwrap_or(0).max(0), p.limit.unwrap_or(50).clamp(1, 200))
                .map_err(err)?;
        Ok(Json(SongPage { total: page.total, songs: page.rows.iter().map(song).collect() }))
    }

    #[tool(
        description = "The albums of the library with their keys (use `album:<key>` in list_songs), artists, year and number of songs. Sort by name (default) or by songs; paged.",
        annotations(title = "List albums", read_only_hint = true, open_world_hint = false)
    )]
    fn list_albums(&self, Parameters(p): Parameters<ListNamesParams>) -> Result<Json<AlbumPage>, String> {
        let db = self.db()?;
        let sort = if matches!(p.sort, Some(NameOrder::Songs)) { NameSort::SongsDesc } else { NameSort::NameAsc };
        let all = library::albums(&db, sort).map_err(err)?;
        let total = all.len() as i64;
        let albums = all
            .into_iter()
            .skip(p.offset.unwrap_or(0).max(0) as usize)
            .take(p.limit.unwrap_or(100).clamp(1, 500) as usize)
            .map(|a| AlbumOut {
                key: a.key,
                title: a.title,
                artists: a.artists,
                year: a.year,
                song_count: a.song_count,
            })
            .collect();
        Ok(Json(AlbumPage { total, albums }))
    }

    #[tool(
        description = "The artists of the library (track and album artists) with how many songs each has. Sort by name (default) or by songs; paged. Use `artist:<name>` in list_songs for their songs.",
        annotations(title = "List artists", read_only_hint = true, open_world_hint = false)
    )]
    fn list_artists(&self, Parameters(p): Parameters<ListNamesParams>) -> Result<Json<NamedPage>, String> {
        let db = self.db()?;
        let sort = if matches!(p.sort, Some(NameOrder::Songs)) { NameSort::SongsDesc } else { NameSort::NameAsc };
        named_page(library::artists(&db, sort).map_err(err)?, &p)
    }

    #[tool(
        description = "The genres of the library with how many songs each has. Sort by name (default) or by songs; paged. Use `genre:<name>` in list_songs for their songs.",
        annotations(title = "List genres", read_only_hint = true, open_world_hint = false)
    )]
    fn list_genres(&self, Parameters(p): Parameters<ListNamesParams>) -> Result<Json<NamedPage>, String> {
        let db = self.db()?;
        let sort = if matches!(p.sort, Some(NameOrder::Songs)) { NameSort::SongsDesc } else { NameSort::NameAsc };
        named_page(library::genres(&db, sort).map_err(err)?, &p)
    }

    #[tool(
        description = "The user's playlists with their ids and song counts. Favorites is one of them (id `Favorites`).",
        annotations(title = "List playlists", read_only_hint = true, open_world_hint = false)
    )]
    fn list_playlists(&self) -> Result<Json<Playlists>, String> {
        let db = self.db()?;
        let favorites = nemora_core::playlists::favorites(&db).map_err(err)?.len() as i64;
        let mut playlists =
            vec![PlaylistOut { playlist_id: "Favorites".into(), name: "Favorites".into(), song_count: favorites }];
        playlists.extend(nemora_core::playlists::list(&db).map_err(err)?.into_iter().map(|p| PlaylistOut {
            playlist_id: p.id,
            name: p.name,
            song_count: p.song_count,
        }));
        Ok(Json(Playlists { playlists }))
    }

    #[tool(
        description = "One playlist's songs in its order, and the entries whose file is missing.",
        annotations(title = "Get a playlist", read_only_hint = true, open_world_hint = false)
    )]
    fn get_playlist(&self, Parameters(p): Parameters<PlaylistParams>) -> Result<Json<PlaylistDetail>, String> {
        let db = self.db()?;
        if p.playlist_id.eq_ignore_ascii_case("favorites") || p.playlist_id.eq_ignore_ascii_case("favourites") {
            let ids = nemora_core::playlists::favorites(&db).map_err(err)?;
            let songs = rows_for_songs(&db, &ids)?.iter().map(song).collect();
            return Ok(Json(PlaylistDetail {
                playlist_id: "Favorites".into(),
                name: "Favorites".into(),
                songs,
                missing: Vec::new(),
            }));
        }
        let list = nemora_core::playlists::list(&db).map_err(err)?;
        let meta = list
            .iter()
            .find(|x| x.id == p.playlist_id || x.name.eq_ignore_ascii_case(&p.playlist_id))
            .ok_or_else(|| format!("No playlist `{}`. See list_playlists.", p.playlist_id))?;
        let items = nemora_core::playlists::items(&db, &meta.id, true).map_err(err)?;
        let present: Vec<i64> = items.iter().filter_map(|i| i.variant_id).collect();
        let rows = library::rows_by_id(&db, &present).map_err(err)?;
        let by: HashMap<i64, &SongRow> = rows.iter().map(|r| (r.variant_id, r)).collect();
        let mut songs = Vec::new();
        let mut missing = Vec::new();
        for item in &items {
            match item.variant_id.and_then(|v| by.get(&v)) {
                Some(row) => songs.push(song(row)),
                None => missing.push(if item.artists.is_empty() {
                    item.title.clone()
                } else {
                    format!("{} — {}", item.title, item.artists.join(", "))
                }),
            }
        }
        Ok(Json(PlaylistDetail { playlist_id: meta.id.clone(), name: meta.name.clone(), songs, missing }))
    }

    #[tool(
        description = "Listening statistics for a period, as Nemora's Stats page shows them: songs, plays, full listens, skips, hours listened, favourites; top songs, artists, albums and genres; the most skipped; plays per hour of the day and per weekday; the current and longest streak of days; the years with plays. Ranges: last_30_days (default), last_12_months, all_time, year (with `year`).",
        annotations(title = "Listening statistics", read_only_hint = true, open_world_hint = false)
    )]
    fn stats_dashboard(&self, Parameters(p): Parameters<DashboardParams>) -> Result<Json<Dashboard>, String> {
        use nemora_core::stats::Range;
        let db = self.db()?;
        let range = match p.range.unwrap_or(RangeParam::Last30Days) {
            RangeParam::AllTime => Range::AllTime,
            RangeParam::Last30Days => Range::Last30Days,
            RangeParam::Last12Months => Range::Last12Months,
            RangeParam::Year => Range::Year(p.year.ok_or("With range `year`, give `year` (for example 2026).")?),
        };
        let today = today(&db);
        let d = nemora_core::stats::dashboard(&db, range, &today).map_err(err)?;
        let top = |list: &[nemora_core::stats::SongEntry]| {
            list.iter()
                .map(|s| TopSong {
                    song_id: s.song_id.clone(),
                    title: s.title.clone(),
                    artists: s.artists.clone(),
                    plays: s.plays,
                    skips: s.skips,
                })
                .collect()
        };
        let names = |list: &[nemora_core::stats::NameEntry]| {
            list.iter().map(|n| Named { name: n.name.clone(), plays: n.plays }).collect()
        };
        Ok(Json(Dashboard {
            period: format!("{:?}", d.range),
            distinct_songs: d.totals.distinct_songs,
            plays: d.totals.plays,
            full_listens: d.totals.full,
            skips: d.totals.skips,
            listening_hours: (d.totals.listening_ms as f64 / 360_000.0).round() / 10.0,
            favorites: d.totals.favorites,
            top_songs: top(&d.top_songs),
            top_artists: names(&d.top_artists),
            top_albums: names(&d.top_albums),
            top_genres: names(&d.top_genres),
            most_skipped: top(&d.most_skipped),
            hours: d.hours,
            weekdays: d.weekdays,
            current_streak_days: d.calendar.current_streak,
            longest_streak_days: d.calendar.longest_streak,
            years_with_plays: d.available_years,
        }))
    }

    #[tool(
        description = "The songs played most recently, latest first (each song once). `days` keeps only plays of the last days.",
        annotations(title = "Listening history", read_only_hint = true, open_world_hint = false)
    )]
    fn listening_history(&self, Parameters(p): Parameters<HistoryParams>) -> Result<Json<History>, String> {
        let db = self.db()?;
        let since = match p.days {
            Some(days) if days > 0 => now_ms() - days * 86_400_000,
            _ => 0,
        };
        let ids = nemora_core::plays::history(&db, p.limit.unwrap_or(30).clamp(1, 200) as usize, since).map_err(err)?;
        Ok(Json(History { songs: rows_for_songs(&db, &ids)?.iter().map(song).collect() }))
    }

    #[tool(
        description = "A song's lyrics as Nemora keeps them, synced (LRC with times) or plain, and where they came from. Only lyrics already in the library; nothing is looked up online.",
        annotations(title = "Get lyrics", read_only_hint = true, open_world_hint = false)
    )]
    fn get_lyrics(&self, Parameters(p): Parameters<SongParams>) -> Result<Json<LyricsOut>, String> {
        let db = self.db()?;
        let id = song_of(&p.song_id).to_owned();
        let (text, source) = nemora_core::lyrics::stored(&db, &id)
            .map_err(err)?
            .ok_or_else(|| format!("No lyrics in the library for {id}."))?;
        Ok(Json(LyricsOut { synced: nemora_core::lyrics::is_synced(&text), song_id: id, source, text }))
    }
}

fn named_page(all: Vec<nemora_core::library::NamedRow>, p: &ListNamesParams) -> Result<Json<NamedPage>, String> {
    let total = all.len() as i64;
    let items = all
        .into_iter()
        .skip(p.offset.unwrap_or(0).max(0) as usize)
        .take(p.limit.unwrap_or(100).clamp(1, 500) as usize)
        .map(|n| NamedOut { name: n.name, song_count: n.song_count })
        .collect();
    Ok(Json(NamedPage { total, items }))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// The user's local day: the offset of their latest play (the app records it), else UTC.
fn today(db: &Db) -> String {
    let offset = nemora_core::plays::latest_utc_offset(db).ok().flatten().unwrap_or(0);
    nemora_core::time::local_day(now_ms(), offset)
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for Nemora {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().build())
            .with_server_info(Implementation::new("nemora", env!("CARGO_PKG_VERSION")))
            .with_instructions(docs::INSTRUCTIONS)
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        let mut resources: Vec<Resource> = docs::DOCS.iter().map(|(uri, name, _)| Resource::new(*uri, *name)).collect();
        resources.push(Resource::new("nemora://library/summary", "Library summary"));
        Ok(ListResourcesResult { resources, ..Default::default() })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        if request.uri == "nemora://library/summary" {
            let summary = self.summary().map_err(|e| ErrorData::internal_error(e, None))?;
            let text =
                serde_json::to_string_pretty(&summary).map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
            return Ok(ReadResourceResult::new(vec![ResourceContents::text(text, &request.uri)]).into());
        }
        match docs::DOCS.iter().find(|(uri, _, _)| *uri == request.uri) {
            Some((uri, _, text)) => Ok(ReadResourceResult::new(vec![ResourceContents::text(*text, *uri)]).into()),
            None => Err(ErrorData::resource_not_found(format!("no resource {}", request.uri), None)),
        }
    }
}
