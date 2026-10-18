//! Commands behind the view's runtime adapter (`src/platform/runtime`). Each takes the arguments
//! of the 1.1.9 runtime method it serves and answers in that method's shape.

use std::collections::HashMap;

use nemora_core::db::Db;
use nemora_core::library::{self, Group, NameSort, SongRow, SongScope, SongSort};
use nemora_core::playlists;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

use crate::app::{App, DefaultArtwork};
use crate::user_data;
use crate::view::{View, parse_view_id, view_id};

type Res<T> = Result<T, String>;

fn fail(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Tells the view which of its data changed, as 1.x `dataUpdated` did.
pub fn notify(app: &AppHandle, types: &[&str]) {
    let _ = app.emit("nemora://data-updated", types);
}

fn view(app: &App) -> View<'_> {
    View { covers: &app.covers, defaults: app.defaults() }
}

// ----- app ------------------------------------------------------------------------------------

/// The first call of the view: hands over the bundled default pictures, returns the user data.
#[tauri::command]
pub fn app_hydrate(app: State<'_, App>, defaults: DefaultArtwork) -> Res<Value> {
    let _ = app.defaults.set(defaults);
    user_data::get(&app.read()).map_err(fail)
}

#[tauri::command]
pub fn user_data_get(app: State<'_, App>) -> Res<Value> {
    user_data::get(&app.read()).map_err(fail)
}

#[tauri::command]
pub fn user_data_set(app: State<'_, App>, key: String, value: Value) -> Res<()> {
    app.write(|db| user_data::set(db, &key, &value)).map_err(fail)
}

/// Whether the first-start import of 1.x is still running, and once it ran, old song id to new
/// song id (null while pending) for what 1.x kept in the renderer's local storage.
#[tauri::command]
pub fn legacy_import_state(app: State<'_, App>) -> Res<Value> {
    let ids = nemora_core::settings::device(&app.read(), "import.songIds").map_err(fail)?;
    Ok(json!({ "running": app.is_importing(), "songIds": ids }))
}

// ----- songs ----------------------------------------------------------------------------------

fn song_sort(sort: Option<&str>, month_start: &str) -> SongSort {
    match sort.unwrap_or("aToZ") {
        "zToA" => SongSort::TitleDesc,
        "addedOrder" | "dateAddedAscending" => SongSort::AddedAsc,
        "dateAddedDescending" => SongSort::AddedDesc,
        "releasedYearAscending" => SongSort::YearAsc,
        "releasedYearDescending" => SongSort::YearDesc,
        "trackNoAscending" => SongSort::TrackAsc,
        "trackNoDescending" => SongSort::TrackDesc,
        "artistNameAscending" => SongSort::ArtistAsc,
        "artistNameDescending" => SongSort::ArtistDesc,
        "albumNameAscending" => SongSort::AlbumAsc,
        "albumNameDescending" => SongSort::AlbumDesc,
        "allTimeMostListened" => SongSort::PlaysDesc,
        "allTimeLeastListened" => SongSort::PlaysAsc,
        "monthlyMostListened" => SongSort::PlaysSinceDesc(month_start.to_owned()),
        "monthlyLeastListened" => SongSort::PlaysSinceAsc(month_start.to_owned()),
        _ => SongSort::TitleAsc,
    }
}

fn song_scope(filter: Option<&str>, sort: Option<&str>) -> SongScope {
    match filter.or(sort) {
        Some("blacklistedSongs") => SongScope::Blacklisted,
        Some("whitelistedSongs") => SongScope::NotBlacklisted,
        _ => SongScope::All,
    }
}

/// The first day of the month of a local `YYYY-MM-DD`.
fn month_start(today: &str) -> String {
    format!("{}-01", today.get(..7).unwrap_or("0000-00"))
}

#[tauri::command]
pub fn library_songs(
    app: State<'_, App>,
    sort_type: Option<String>,
    filter_type: Option<String>,
    start: Option<i64>,
    end: Option<i64>,
    today: String,
) -> Res<Value> {
    let sort = song_sort(sort_type.as_deref(), &month_start(&today));
    let scope = song_scope(filter_type.as_deref(), sort_type.as_deref());
    let db = app.read();
    let start = start.unwrap_or(0);
    let limit = end.map_or(i64::MAX, |e| e - start);
    let page = library::songs(&db, &scope, &sort, start, limit).map_err(fail)?;
    let v = view(&app);
    Ok(json!({
        "data": page.rows.iter().map(|r| v.audio_info(r)).collect::<Vec<_>>(),
        "sortType": sort_type.unwrap_or_else(|| "aToZ".into()),
        "start": start,
        "end": end.unwrap_or(page.total),
        "total": page.total,
    }))
}

/// Rows for view ids, in the given order; ids whose song has no file present are left out.
fn rows_for(db: &Db, ids: &[String]) -> nemora_core::Result<Vec<SongRow>> {
    let bare: Vec<String> = ids.iter().filter(|&id| matches!(parse_view_id(id), (_, None))).cloned().collect();
    let primary = library::primary_variants(db, &bare)?;
    let variants: Vec<i64> = ids
        .iter()
        .filter_map(|id| match parse_view_id(id) {
            (_, Some(variant)) => Some(variant),
            (song, None) => primary.get(song).copied(),
        })
        .collect();
    library::rows_by_id(db, &variants)
}

/// Orders rows as a 1.x sort type would.
fn sort_rows(rows: &mut [SongRow], sort: &SongSort) {
    use nemora_core::search::fold::normalize;
    let title = |r: &SongRow| normalize(&r.title);
    match sort {
        SongSort::TitleAsc => rows.sort_by_cached_key(title),
        SongSort::TitleDesc => {
            rows.sort_by_cached_key(title);
            rows.reverse();
        }
        SongSort::ArtistAsc | SongSort::ArtistDesc => {
            rows.sort_by_cached_key(|r| (normalize(&r.artists.join(", ")), normalize(&r.title)));
            if *sort == SongSort::ArtistDesc {
                rows.reverse();
            }
        }
        SongSort::AlbumAsc | SongSort::AlbumDesc => {
            rows.sort_by_cached_key(|r| (r.album.as_deref().map(normalize), r.disc_no, r.track_no));
            if *sort == SongSort::AlbumDesc {
                rows.reverse();
            }
        }
        SongSort::YearAsc => rows.sort_by_key(|r| (r.year.is_none(), r.year)),
        SongSort::YearDesc => rows.sort_by_key(|r| (r.year.is_none(), std::cmp::Reverse(r.year))),
        SongSort::TrackAsc => rows.sort_by_key(|r| (r.disc_no.unwrap_or(i64::MAX), r.track_no.unwrap_or(i64::MAX))),
        SongSort::TrackDesc => {
            rows.sort_by_key(|r| (r.disc_no.unwrap_or(i64::MAX), r.track_no.unwrap_or(i64::MAX)));
            rows.reverse();
        }
        SongSort::AddedAsc => rows.sort_by_key(|r| r.added_at),
        SongSort::AddedDesc => rows.sort_by_key(|r| std::cmp::Reverse(r.added_at)),
        SongSort::PlaysAsc | SongSort::PlaysSinceAsc(_) => rows.sort_by_key(|r| r.plays),
        SongSort::PlaysDesc | SongSort::PlaysSinceDesc(_) => rows.sort_by_key(|r| std::cmp::Reverse(r.plays)),
    }
}

#[tauri::command]
pub fn library_song_info(
    app: State<'_, App>,
    song_ids: Vec<String>,
    sort_type: Option<String>,
    filter_type: Option<String>,
    limit: Option<usize>,
    preserve_id_order: Option<bool>,
    today: String,
) -> Res<Vec<Value>> {
    let db = app.read();
    let mut rows = rows_for(&db, &song_ids).map_err(fail)?;
    match song_scope(filter_type.as_deref(), None) {
        SongScope::Blacklisted => rows.retain(|r| r.is_blacklisted),
        SongScope::NotBlacklisted => rows.retain(|r| !r.is_blacklisted),
        _ => {}
    }
    if sort_type.is_some() && !preserve_id_order.unwrap_or(false) {
        sort_rows(&mut rows, &song_sort(sort_type.as_deref(), &month_start(&today)));
    }
    if let Some(limit) = limit.filter(|&l| l > 0) {
        rows.truncate(limit);
    }
    let v = view(&app);
    Ok(rows.iter().map(|r| v.song_data(r)).collect())
}

#[tauri::command]
pub fn library_song_for_playback(app: State<'_, App>, song_id: String) -> Res<Value> {
    let db = app.read();
    let row = rows_for(&db, std::slice::from_ref(&song_id)).map_err(fail)?.into_iter().next();
    let row = row.filter(|r| r.path.is_some()).ok_or("SONG_NOT_FOUND")?;
    Ok(view(&app).player_data(&row))
}

// ----- artists, albums, genres ----------------------------------------------------------------

fn name_sort(sort: Option<&str>) -> NameSort {
    match sort {
        Some("zToA") => NameSort::NameDesc,
        Some("noOfSongsAscending") => NameSort::SongsAsc,
        Some("noOfSongsDescending") => NameSort::SongsDesc,
        _ => NameSort::NameAsc,
    }
}

/// Keeps the entries whose key is asked for, in the asked order; all of them when nothing is.
fn pick<T: Clone>(rows: Vec<T>, wanted: &[String], key: impl Fn(&T) -> Vec<&str>) -> Vec<T> {
    if wanted.is_empty() {
        return rows;
    }
    wanted
        .iter()
        .flat_map(|w| rows.iter().filter(|r| key(r).contains(&w.as_str())).cloned().collect::<Vec<_>>())
        .collect()
}

fn artists_of(
    db: &Db,
    v: &View,
    wanted: &[String],
    sort: Option<&str>,
    limit: usize,
) -> nemora_core::Result<Vec<Value>> {
    let mut rows = pick(library::artists(db, name_sort(sort))?, wanted, |r| vec![r.name.as_str()]);
    if limit > 0 {
        rows.truncate(limit);
    }
    let members = library::members(db, Group::Artist)?;
    Ok(rows.iter().map(|r| v.artist(r, members.get(&r.name).map_or(&[], Vec::as_slice))).collect())
}

fn albums_of(db: &Db, v: &View, wanted: &[String], sort: Option<&str>) -> nemora_core::Result<Vec<Value>> {
    let rows = pick(library::albums(db, name_sort(sort))?, wanted, |r| vec![r.key.as_str(), r.title.as_str()]);
    let members = library::members(db, Group::Album)?;
    Ok(rows.iter().map(|r| v.album(r, members.get(&r.key).map_or(&[], Vec::as_slice))).collect())
}

fn genres_of(db: &Db, v: &View, wanted: &[String], sort: Option<&str>) -> nemora_core::Result<Vec<Value>> {
    let rows = pick(library::genres(db, name_sort(sort))?, wanted, |r| vec![r.name.as_str()]);
    let members = library::members(db, Group::Genre)?;
    Ok(rows.iter().map(|r| v.genre(r, members.get(&r.name).map_or(&[], Vec::as_slice))).collect())
}

#[tauri::command]
pub fn library_artists(
    app: State<'_, App>,
    ids_or_names: Option<Vec<String>>,
    sort_type: Option<String>,
    limit: Option<usize>,
) -> Res<Vec<Value>> {
    artists_of(&app.read(), &view(&app), &ids_or_names.unwrap_or_default(), sort_type.as_deref(), limit.unwrap_or(0))
        .map_err(fail)
}

#[tauri::command]
pub fn library_albums(
    app: State<'_, App>,
    ids_or_titles: Option<Vec<String>>,
    sort_type: Option<String>,
) -> Res<Vec<Value>> {
    albums_of(&app.read(), &view(&app), &ids_or_titles.unwrap_or_default(), sort_type.as_deref()).map_err(fail)
}

#[tauri::command]
pub fn library_genres(
    app: State<'_, App>,
    ids_or_names: Option<Vec<String>>,
    sort_type: Option<String>,
) -> Res<Vec<Value>> {
    genres_of(&app.read(), &view(&app), &ids_or_names.unwrap_or_default(), sort_type.as_deref()).map_err(fail)
}

// ----- playlists ------------------------------------------------------------------------------

/// The view id of each present song, for documents that store song ids.
fn present_ids(db: &Db, songs: Vec<String>) -> nemora_core::Result<Vec<String>> {
    let primary = library::primary_variants(db, &songs)?;
    Ok(songs.into_iter().filter(|s| primary.contains_key(s)).collect())
}

fn playlists_of(
    db: &Db,
    v: &View,
    wanted: &[String],
    sort: Option<&str>,
    mutable_only: bool,
) -> nemora_core::Result<Vec<Value>> {
    let mut out: Vec<(String, i64, Value)> = Vec::new();
    if !mutable_only {
        let system: [(&str, Vec<String>); 3] = [
            ("Favorites", playlists::favorites(db)?),
            ("History", nemora_core::plays::recent_songs(db, 500)?),
            ("Rediscover", stored_rediscover(db)),
        ];
        for (id, songs) in system {
            let songs = present_ids(db, songs)?;
            out.push((id.to_owned(), songs.len() as i64, v.playlist(id, id, songs, 0, None)));
        }
    }
    let show_missing = playlists::show_missing_in_playlists(db)?;
    for row in playlists::list(db)? {
        let songs: Vec<String> = playlists::items(db, &row.id, show_missing)?
            .into_iter()
            .filter_map(|i| Some(view_id(i.song_id.as_deref()?, i.variant_id?, true)))
            .collect();
        let count = songs.len() as i64;
        let cover = row.covers.first().map(String::as_str);
        out.push((row.name.clone(), count, v.playlist(&row.id, &row.name, songs, row.created_at, cover)));
    }
    use nemora_core::search::fold::normalize;
    match sort {
        Some("aToZ") => out.sort_by_cached_key(|(n, _, _)| normalize(n)),
        Some("zToA") => {
            out.sort_by_cached_key(|(n, _, _)| normalize(n));
            out.reverse();
        }
        Some("noOfSongsAscending") => out.sort_by_key(|(_, c, _)| *c),
        Some("noOfSongsDescending") => out.sort_by_key(|(_, c, _)| std::cmp::Reverse(*c)),
        _ => {}
    }
    // In the asked order when ids are given, as 1.x returned them.
    let all: Vec<Value> = out.into_iter().map(|(_, _, p)| p).collect();
    if wanted.is_empty() {
        return Ok(all);
    }
    Ok(wanted.iter().filter_map(|w| all.iter().find(|p| p["playlistId"] == w.as_str()).cloned()).collect())
}

#[tauri::command]
pub fn library_playlists(
    app: State<'_, App>,
    ids: Option<Vec<String>>,
    sort_type: Option<String>,
    mutable_only: Option<bool>,
) -> Res<Vec<Value>> {
    playlists_of(
        &app.read(),
        &view(&app),
        &ids.unwrap_or_default(),
        sort_type.as_deref(),
        mutable_only.unwrap_or(false),
    )
    .map_err(fail)
}

// ----- search ---------------------------------------------------------------------------------

/// Ranked search over the present library, as 1.1.9's search page reads it. The search history is
/// the view's (it lives in the user data).
#[tauri::command]
pub fn library_search(app: State<'_, App>, filter: String, value: String) -> Res<Value> {
    use nemora_core::search::{Filter, search};
    let filter = match filter.as_str() {
        "Songs" => Filter::Songs,
        "Artists" => Filter::Artists,
        "Albums" => Filter::Albums,
        "Playlists" => Filter::Playlists,
        "Genres" => Filter::Genres,
        _ => Filter::All,
    };
    let corpus = app.corpus().map_err(fail)?;
    let found = search(&corpus, filter, &value);
    let db = app.read();
    let v = view(&app);
    let variants: Vec<i64> = found.songs.iter().filter_map(|id| id.parse().ok()).collect();
    let songs: Vec<Value> = library::rows_by_id(&db, &variants).map_err(fail)?.iter().map(|r| v.song_data(r)).collect();
    let artists = if found.artists.is_empty() {
        Vec::new()
    } else {
        artists_of(&db, &v, &found.artists, None, 0).map_err(fail)?
    };
    let albums =
        if found.albums.is_empty() { Vec::new() } else { albums_of(&db, &v, &found.albums, None).map_err(fail)? };
    let genres =
        if found.genres.is_empty() { Vec::new() } else { genres_of(&db, &v, &found.genres, None).map_err(fail)? };
    let playlists = if found.playlists.is_empty() {
        Vec::new()
    } else {
        playlists_of(&db, &v, &found.playlists, None, true).map_err(fail)?
    };
    Ok(json!({
        "songs": songs, "artists": artists, "albums": albums, "playlists": playlists, "genres": genres,
        "availableResults": found.suggestions,
    }))
}

/// The Rediscover list as last refreshed.
fn stored_rediscover(db: &Db) -> Vec<String> {
    nemora_core::settings::device(db, "rediscover.songs")
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

// ----- statistics -----------------------------------------------------------------------------

/// The statistics page (1.x `StatsData`) over the 2.0 roll-ups. Every figure follows the range;
/// only the calendar is the trailing 53 weeks by definition.
#[tauri::command]
pub fn stats_dashboard(app: State<'_, App>, time_range: String, today: String) -> Res<Value> {
    use nemora_core::elo::Winner;
    use nemora_core::stats::{Range, dashboard};
    let range = match time_range.as_str() {
        "last12Months" => Range::Last12Months,
        "last30Days" => Range::Last30Days,
        other => other.strip_prefix("year:").and_then(|y| y.parse().ok()).map_or(Range::AllTime, Range::Year),
    };
    let db = app.read();
    let v = view(&app);
    let d = dashboard(&db, range, &today).map_err(fail)?;
    let cover = |hash: &Option<String>| v.artwork(hash.as_deref(), &v.defaults.song)["artworkPath"].clone();
    let song_entry = |e: &nemora_core::stats::SongEntry| {
        json!({
            "songId": e.song_id, "title": e.title, "artists": e.artists, "artworkPath": cover(&e.cover_hash),
            "listensInRange": e.plays, "skips": e.skips,
        })
    };
    let names = |list: &[nemora_core::stats::NameEntry], artist: bool| -> Vec<Value> {
        list.iter()
            .map(|n| {
                let mut entry = json!({ "name": n.name, "listens": n.plays });
                if artist {
                    entry["artistId"] = json!(n.name);
                }
                entry
            })
            .collect()
    };
    let day = |b: &nemora_core::stats::Bucket| json!({ "date": b.label, "listens": b.plays });

    // The ELO block: best rated songs and the latest duels, with titles from the library.
    let (standings, _) = nemora_core::elo::standings(&db, 10, 0).map_err(fail)?;
    let recent = nemora_core::elo::recent_duels(&db, 10).map_err(fail)?;
    let mut wanted: Vec<String> = standings.iter().map(|s| s.song_id.clone()).collect();
    wanted.extend(recent.iter().flat_map(|d| [d.a.clone(), d.b.clone()]));
    let rows: HashMap<String, SongRow> =
        rows_for(&db, &wanted).map_err(fail)?.into_iter().map(|r| (r.song_id.clone(), r)).collect();
    let title = |id: &str| rows.get(id).map_or_else(String::new, |r| r.title.clone());
    let top_rated: Vec<Value> = standings
        .iter()
        .filter_map(|s| {
            let r = rows.get(&s.song_id)?;
            Some(json!({
                "songId": s.song_id, "title": r.title, "artists": r.artists,
                "artworkPath": cover(&r.cover_hash), "listensInRange": 0,
                "rating": s.rating.rating, "effectiveRating": s.effective, "isProvisional": s.provisional,
                "games": s.rating.games, "wins": s.rating.wins, "losses": s.rating.losses, "draws": s.rating.draws,
            }))
        })
        .collect();
    let recent_duels: Vec<Value> = recent
        .iter()
        .map(|d| {
            json!({
                "at": d.at, "titleA": title(&d.a), "titleB": title(&d.b), "winner": match d.winner { Winner::A => "A", Winner::B => "B", Winner::Draw => "draw" },
                "deltaA": d.delta_a, "deltaB": d.delta_b,
            })
        })
        .collect();
    let range_scope = "range";
    Ok(json!({
        "timeRange": time_range,
        "scopes": {
            "totalListens": range_scope, "fullListens": range_scope, "skips": range_scope,
            "distinctSongsPlayed": range_scope, "approxListeningTimeSec": range_scope, "favorites": "allTime",
            "activity": range_scope, "calendar": "allTime", "topSongs": range_scope, "topArtists": range_scope,
            "topAlbums": range_scope, "topGenres": range_scope, "mostSkipped": range_scope, "elo": "allTime",
        },
        "availableYears": d.available_years,
        "hourHistogram": d.hours,
        "weekdayHistogram": d.weekdays,
        "hourDataSince": d.hours_since.as_deref().and_then(nemora_core::time::parse_day).map(|days| days * 86_400_000),
        "totals": {
            "distinctSongsPlayed": d.totals.distinct_songs, "totalListens": d.totals.plays,
            "fullListens": d.totals.full, "skips": d.totals.skips,
            "approxListeningTimeSec": d.totals.listening_ms / 1000, "favorites": d.totals.favorites,
        },
        "activity": d.activity.iter().map(|b| json!({ "label": b.label, "listens": b.plays })).collect::<Vec<_>>(),
        "calendar": {
            "days": d.calendar.days.iter().map(day).collect::<Vec<_>>(),
            "currentStreak": d.calendar.current_streak,
            "longestStreak": d.calendar.longest_streak,
            "mostActiveDay": d.calendar.most_active_day.as_ref().map(day),
        },
        "topSongs": d.top_songs.iter().map(song_entry).collect::<Vec<_>>(),
        "topArtists": names(&d.top_artists, true),
        "topAlbums": names(&d.top_albums, false),
        "topGenres": names(&d.top_genres, false),
        "mostSkipped": d.most_skipped.iter().map(song_entry).collect::<Vec<_>>(),
        "elo": {
            "totalDuels": nemora_core::elo::total_duels(&db).map_err(fail)?,
            "topRated": top_rated,
            "recentDuels": recent_duels,
        },
    }))
}

// ----- playback facts -------------------------------------------------------------------------

/// One thing the player saw, as the view reports it.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FactInput {
    #[serde(rename_all = "camelCase")]
    Play { at_ms: i64, position_ms: i64 },
    #[serde(rename_all = "camelCase")]
    Pause { at_ms: i64, position_ms: i64 },
    #[serde(rename_all = "camelCase")]
    Seek { at_ms: i64, from_ms: i64, to_ms: i64 },
    #[serde(rename_all = "camelCase")]
    End { at_ms: i64, position_ms: i64, reason: String },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    song_id: String,
    started_at: i64,
    utc_offset_min: i64,
    duration_ms: i64,
    source_kind: Option<String>,
    source_id: Option<String>,
    facts: Vec<FactInput>,
}

/// Stores one finished session of one song; the core decides whether it was a play, a skip or a
/// full listen (listening definitions 2.0).
#[tauri::command]
pub fn play_record(handle: AppHandle, app: State<'_, App>, session: SessionInput) -> Res<Value> {
    use nemora_core::plays::{EndReason, Fact, Session, record};
    let facts = session
        .facts
        .into_iter()
        .map(|f| match f {
            FactInput::Play { at_ms, position_ms } => Fact::Play { at_ms, position_ms },
            FactInput::Pause { at_ms, position_ms } => Fact::Pause { at_ms, position_ms },
            FactInput::Seek { at_ms, from_ms, to_ms } => Fact::Seek { at_ms, from_ms, to_ms },
            FactInput::End { at_ms, position_ms, reason } => {
                Fact::End { at_ms, position_ms, reason: EndReason::parse(&reason).unwrap_or(EndReason::Stopped) }
            }
        })
        .collect();
    let session = Session {
        song_id: parse_view_id(&session.song_id).0.to_owned(),
        started_at: session.started_at,
        utc_offset_min: session.utc_offset_min,
        duration_ms: session.duration_ms,
        source_kind: session.source_kind,
        source_id: session.source_id,
        facts,
    };
    let recorded = app.write(|db| record(db, &session)).map_err(fail)?;
    let e = &recorded.evaluation;
    notify(&handle, &["songs/listeningData", "playlists/history", "userData/recentlyPlayedSongs"]);
    Ok(json!({
        "isPlay": e.is_play, "isFull": e.is_full, "isSkip": e.is_skip, "heardMs": e.heard_ms, "scrobble": e.scrobble,
    }))
}

// ----- hearts and blacklist -------------------------------------------------------------------

#[tauri::command]
pub fn favorites_toggle(
    handle: AppHandle,
    app: State<'_, App>,
    song_ids: Vec<String>,
    like: Option<bool>,
) -> Res<Value> {
    let (mut likes, mut dislikes) = (Vec::new(), Vec::new());
    app.write(|db| {
        let current: std::collections::HashSet<String> = playlists::favorites(db)?.into_iter().collect();
        for id in &song_ids {
            let song = parse_view_id(id).0;
            let value = like.unwrap_or(!current.contains(song));
            playlists::set_favorite(db, song, value)?;
            if value { likes.push(id.clone()) } else { dislikes.push(id.clone()) }
        }
        Ok(())
    })
    .map_err(fail)?;
    notify(&handle, &["songs/likes", "playlists"]);
    Ok(json!({ "likes": likes, "dislikes": dislikes }))
}

#[tauri::command]
pub fn library_blacklist(app: State<'_, App>) -> Res<Value> {
    let db = app.read();
    let folders: Vec<String> = Vec::new();
    Ok(json!({ "songBlacklist": playlists::blacklisted(&db).map_err(fail)?, "folderBlacklist": folders }))
}

// ----- folders and scanning -------------------------------------------------------------------

#[tauri::command]
pub fn library_folder_structures(app: State<'_, App>) -> Res<Vec<Value>> {
    user_data::music_folders(&app.read()).map_err(fail)
}

/// Brings the library in line with the music folders.
#[tauri::command]
pub async fn library_rescan(handle: AppHandle, app: State<'_, App>) -> Res<Value> {
    let report = app.scan().map_err(fail)?;
    let changed = report.added + report.updated + report.restored + report.missing > 0;
    if changed {
        notify(&handle, &["songs", "artists", "albums", "genres", "playlists", "userData/musicFolder"]);
    }
    Ok(json!({
        "files": report.files, "added": report.added, "updated": report.updated,
        "restored": report.restored, "missing": report.missing, "failed": report.failed.len(),
    }))
}

/// Per-song listening data in the 1.x shape: totals and day counts grouped by year.
#[tauri::command]
pub fn library_listening(app: State<'_, App>, song_ids: Vec<String>) -> Res<Vec<Value>> {
    let db = app.read();
    let mut out = Vec::with_capacity(song_ids.len());
    for id in song_ids {
        let song = parse_view_id(&id).0;
        let days = nemora_core::stats::song_days(&db, song).map_err(fail)?;
        let totals = nemora_core::stats::song_totals(&db, song).map_err(fail)?;
        let mut by_year: HashMap<i64, Vec<(i64, i64)>> = HashMap::new();
        for (day, plays) in days {
            let Some(d) = nemora_core::time::parse_day(&day) else { continue };
            let (y, _, _) = nemora_core::time::civil_from_days(d);
            by_year.entry(y).or_default().push((d * 86_400_000, plays));
        }
        let mut years: Vec<_> = by_year.into_iter().collect();
        years.sort_by_key(|(y, _)| *y);
        out.push(json!({
            "songId": id,
            "skips": totals.skips,
            "fullListens": totals.full,
            "inNoOfPlaylists": 0,
            "listens": years.into_iter().map(|(year, listens)| json!({ "year": year, "listens": listens })).collect::<Vec<_>>(),
            "seeks": [],
        }));
    }
    Ok(out)
}
