//! Library changes (PLAN/22 P22.3) through the running app, file changes (P22.4) at the user's
//! `full` level, and the reads of taste the core keeps (tierlists, duels, insights, Rediscover).

use std::collections::HashMap;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::{Peer, RoleServer, tool, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::pipe;
use crate::server::{Nemora, Song, rows_for_songs, song};

fn agent(peer: &Peer<RoleServer>) -> String {
    peer.peer_info()
        .map(|info| info.client_info.name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "an agent".into())
}

async fn call(peer: &Peer<RoleServer>, method: &str, params: Value) -> Result<Json<Value>, String> {
    pipe::call(method, params, &agent(peer), true).await.map(Json)
}

fn ids(list: &[String]) -> Vec<String> {
    list.iter().map(|id| id.split(':').next().unwrap_or(id).trim().to_owned()).collect()
}

// ----- parameters ------------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreatePlaylist {
    name: String,
    /// Songs to put in it, in order (may be left out for an empty playlist).
    #[serde(default)]
    song_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenamePlaylist {
    playlist_id: String,
    name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlaylistSongs {
    playlist_id: String,
    song_ids: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeletePlaylist {
    playlist_id: String,
    /// Must be true: say what will be deleted and have the user agree first.
    confirm: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct Favorite {
    song_ids: Vec<String>,
    /// true to love (the default), false to unlove.
    #[serde(default)]
    favorite: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SaveLyrics {
    song_id: String,
    /// Plain text, or LRC (`[mm:ss.xx] line`) for synced lyrics.
    text: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateVersion {
    song_id: String,
    /// Its name in lists, for example "Slowed + Reverb".
    name: String,
    /// Speed as semitones: -12 to 12 (negative is slower and lower: Slowed is about -2).
    #[serde(default)]
    semitones: Option<f64>,
    /// Keep the pitch while the speed changes (off by default: the pitch goes with the speed).
    #[serde(default)]
    keep_pitch: Option<bool>,
    /// Reverb amount 0 to 1 (0.35 is the usual "+ Reverb").
    #[serde(default)]
    reverb: Option<f64>,
    /// Reverb size: room, hall (default) or vast.
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SwitchVersion {
    song_id: String,
    /// The song's own sound; leave out (or null) to go back to the original.
    #[serde(default)]
    sound: Option<SoundParams>,
    /// Also write it into the song's file (needs the `full` level).
    #[serde(default)]
    write_file: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SoundParams {
    semitones: f64,
    #[serde(default)]
    keep_pitch: bool,
    #[serde(default)]
    reverb: f64,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SpotifyLink {
    /// `https://open.spotify.com/playlist/<id>` of a public playlist.
    link: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ImportSpotify {
    link: String,
    /// The new playlist's name (the Spotify one by default).
    #[serde(default)]
    name: Option<String>,
    /// Also take matches found with a slightly different title or length (true by default).
    #[serde(default)]
    include_likely: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SubmitDuel {
    song_a_id: String,
    song_b_id: String,
    /// The one the user prefers: song_a_id or song_b_id.
    winner_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct EditTags {
    song_id: String,
    /// Only what changes: title, artists (list), albumArtists (list), album, genres (list), year,
    /// trackNumber, composer; null clears album, year, trackNumber or composer.
    changes: Value,
    /// true (the default): only show what would change. false: write the file (the `full` level).
    #[serde(default)]
    dry_run: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteSongs {
    song_ids: Vec<String>,
    /// Must be true: list what goes and have the user agree first.
    confirm: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct Rediscover {
    /// Songs not heard for at least this many days (30 by default).
    #[serde(default)]
    days: Option<i64>,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct Standings {
    /// How many of the best rated (20 by default, at most 200).
    #[serde(default)]
    top: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TierlistParams {
    /// From list_tierlists.
    tierlist_id: String,
}

// ----- answers ---------------------------------------------------------------------------------

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TierlistSummary {
    tierlist_id: String,
    name: String,
    /// Tier names with how many songs each holds, best first.
    tiers: Vec<TierCount>,
    /// Whether it steers Smart Shuffle.
    influences_shuffle: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct TierCount {
    name: String,
    songs: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct Tierlists {
    tierlists: Vec<TierlistSummary>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TierlistDetail {
    tierlist_id: String,
    name: String,
    tiers: Vec<Tier>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct Tier {
    name: String,
    songs: Vec<Song>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct RatedSong {
    #[serde(flatten)]
    song: Song,
    rating: f64,
    games: i64,
    wins: i64,
    losses: i64,
    /// Too few duels yet for the rating to have settled.
    provisional: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct StandingsOut {
    songs: Vec<RatedSong>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SongList {
    songs: Vec<Song>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct InsightsOut {
    /// Each a finding about the user's listening, in plain words, with the songs it is about.
    insights: Vec<InsightOut>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct InsightOut {
    kind: String,
    text: String,
    songs: Vec<Song>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[tool_router(router = library_router, vis = "pub(crate)")]
impl Nemora {
    // ----- reads, straight from the library ----------------------------------------------------

    #[tool(
        description = "The user's tierlists: names, their tiers (S, A, B ... as the user named them, best first) with song counts, and whether each steers Smart Shuffle.",
        annotations(title = "List tierlists", read_only_hint = true, open_world_hint = false)
    )]
    fn list_tierlists(&self) -> Result<Json<Tierlists>, String> {
        let db = self.db()?;
        let tierlists = nemora_core::playlists::tierlists(&db)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(id, doc)| TierlistSummary {
                tierlist_id: id,
                name: doc["name"].as_str().unwrap_or("Tierlist").to_owned(),
                tiers: doc["tiers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|t| TierCount {
                        name: t["name"].as_str().unwrap_or("").to_owned(),
                        songs: t["items"].as_array().map_or(0, |i| i.len() as i64),
                    })
                    .collect(),
                influences_shuffle: doc["influencesShuffle"].as_bool().unwrap_or(false),
            })
            .collect();
        Ok(Json(Tierlists { tierlists }))
    }

    #[tool(
        description = "One tierlist with its songs tier by tier, best tier first: how the user ranks their music.",
        annotations(title = "Get a tierlist", read_only_hint = true, open_world_hint = false)
    )]
    fn get_tierlist(&self, Parameters(p): Parameters<TierlistParams>) -> Result<Json<TierlistDetail>, String> {
        let db = self.db()?;
        let (id, doc) = nemora_core::playlists::tierlists(&db)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|(id, doc)| *id == p.tierlist_id || doc["name"].as_str() == Some(p.tierlist_id.as_str()))
            .ok_or_else(|| format!("No tierlist `{}`; see list_tierlists.", p.tierlist_id))?;
        let mut tiers = Vec::new();
        for t in doc["tiers"].as_array().into_iter().flatten() {
            let ids: Vec<String> = t["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|s| s.split(':').next().unwrap_or(s).to_owned())
                .collect();
            tiers.push(Tier {
                name: t["name"].as_str().unwrap_or("").to_owned(),
                songs: rows_for_songs(&db, &ids)?.iter().map(song).collect(),
            });
        }
        Ok(Json(TierlistDetail { tierlist_id: id, name: doc["name"].as_str().unwrap_or("Tierlist").to_owned(), tiers }))
    }

    #[tool(
        description = "The best rated songs by the user's duels (ELO: the user picked the better of two songs, many times), with games, wins and losses; `provisional` when a song has had too few duels.",
        annotations(title = "Duel ratings", read_only_hint = true, open_world_hint = false)
    )]
    fn duel_standings(&self, Parameters(p): Parameters<Standings>) -> Result<Json<StandingsOut>, String> {
        let db = self.db()?;
        let (top, _) = nemora_core::elo::standings(&db, p.top.unwrap_or(20).clamp(1, 200) as usize, 0)
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = top.iter().map(|s| s.song_id.clone()).collect();
        let rows = rows_for_songs(&db, &ids)?;
        let by: HashMap<&str, &nemora_core::library::SongRow> = rows.iter().map(|r| (r.song_id.as_str(), r)).collect();
        let songs = top
            .iter()
            .filter_map(|s| {
                by.get(s.song_id.as_str()).map(|r| RatedSong {
                    song: song(r),
                    rating: (s.effective * 10.0).round() / 10.0,
                    games: s.rating.games,
                    wins: s.rating.wins,
                    losses: s.rating.losses,
                    provisional: s.provisional,
                })
            })
            .collect();
        Ok(Json(StandingsOut { songs }))
    }

    #[tool(
        description = "Songs the user loved (tierlists, duels, full listens) but has not heard for a while: Nemora's Rediscover shelf.",
        annotations(title = "Rediscover", read_only_hint = true, open_world_hint = false)
    )]
    fn rediscover(&self, Parameters(p): Parameters<Rediscover>) -> Result<Json<SongList>, String> {
        let db = self.db()?;
        let offset = nemora_core::plays::latest_utc_offset(&db).ok().flatten().unwrap_or(0);
        let today = nemora_core::time::local_day(now_ms(), offset);
        let mut ids =
            nemora_core::rediscover::stored(&db, p.days.unwrap_or(30).max(1), &today).map_err(|e| e.to_string())?;
        ids.truncate(p.limit.unwrap_or(30).clamp(1, 200) as usize);
        Ok(Json(SongList { songs: rows_for_songs(&db, &ids)?.iter().map(song).collect() }))
    }

    #[tool(
        description = "What stands out in the user's recent listening, as Nemora's Stats page tells it: this week against the last, songs out of rotation, rising songs, the hours most played.",
        annotations(title = "Listening insights", read_only_hint = true, open_world_hint = false)
    )]
    fn insights(&self) -> Result<Json<InsightsOut>, String> {
        use nemora_core::insights::Insight;
        let db = self.db()?;
        let history = nemora_core::insights::stored(&db, None, now_ms()).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for insight in nemora_core::insights::all(&history) {
            let (kind, text, songs) = match insight {
                Insight::Week { heard_ms, before_ms, songs, songs_before, first_time } => (
                    "week",
                    format!(
                        "This week {:.1} h over {songs} songs ({first_time} heard for the first time), against {:.1} h over {songs_before} the week before.",
                        heard_ms as f64 / 3.6e6,
                        before_ms as f64 / 3.6e6
                    ),
                    Vec::new(),
                ),
                Insight::OutOfRotation { songs, plays } => (
                    "out_of_rotation",
                    format!(
                        "{} songs played a lot one to three months ago ({} plays together) and not at all this month.",
                        songs.len(),
                        plays.iter().sum::<i64>()
                    ),
                    songs,
                ),
                Insight::Rising { songs, .. } => (
                    "rising",
                    format!("{} songs heard or winning duels much more in the last two weeks.", songs.len()),
                    songs,
                ),
                Insight::Islands { grew, faded } => (
                    "islands",
                    format!(
                        "Grew: {}. Faded: {}.",
                        grew.map_or_else(|| "none".to_owned(), |g| g.1),
                        faded.map_or_else(|| "none".to_owned(), |f| f.1)
                    ),
                    Vec::new(),
                ),
                Insight::Hours { from, to, share, plays } => (
                    "hours",
                    format!("Most listening between {from}:00 and {to}:00: {:.0}% of {plays} plays.", share * 100.0),
                    Vec::new(),
                ),
            };
            out.push(InsightOut {
                kind: kind.into(),
                text,
                songs: rows_for_songs(&db, &songs)?.iter().map(song).collect(),
            });
        }
        Ok(Json(InsightsOut { insights: out }))
    }

    // ----- library changes, through the app --------------------------------------------------

    #[tool(
        description = "Create a playlist, optionally with songs in order. Its name must be new. Undo with undo_last_change.",
        annotations(
            title = "Create a playlist",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn create_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<CreatePlaylist>,
    ) -> Result<Json<Value>, String> {
        let mut params = json!({ "name": p.name });
        if let Some(list) = p.song_ids.filter(|l| !l.is_empty()) {
            params["songIds"] = json!(ids(&list));
        }
        call(&peer, "library.playlist_create", params).await
    }

    #[tool(
        description = "Rename a playlist. Undo with undo_last_change.",
        annotations(
            title = "Rename a playlist",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn rename_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<RenamePlaylist>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.playlist_rename", json!({ "playlistId": p.playlist_id, "name": p.name })).await
    }

    #[tool(
        description = "Add songs to the end of a playlist; songs already in it are left as they are. For Favorites use set_favorite. Undo with undo_last_change.",
        annotations(
            title = "Add to a playlist",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn add_to_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<PlaylistSongs>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.playlist_add", json!({ "playlistId": p.playlist_id, "songIds": ids(&p.song_ids) })).await
    }

    #[tool(
        description = "Remove songs from a playlist (the songs stay in the library). Undo with undo_last_change, which puts them back at the end.",
        annotations(
            title = "Remove from a playlist",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn remove_from_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<PlaylistSongs>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.playlist_remove", json!({ "playlistId": p.playlist_id, "songIds": ids(&p.song_ids) }))
            .await
    }

    #[tool(
        description = "Delete a playlist (its songs stay in the library). Ask the user first and pass confirm: true. Undo with undo_last_change brings it back with its songs.",
        annotations(
            title = "Delete a playlist",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn delete_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<DeletePlaylist>,
    ) -> Result<Json<Value>, String> {
        if !p.confirm {
            return Err("Deleting a playlist needs confirm: true, after the user agreed.".into());
        }
        call(&peer, "library.playlist_delete", json!({ "playlistId": p.playlist_id })).await
    }

    #[tool(
        description = "Love or unlove songs (Favorites; a heart in Nemora). Undo with undo_last_change.",
        annotations(
            title = "Set favourite",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn set_favorite(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<Favorite>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.favorite", json!({ "songIds": ids(&p.song_ids), "favorite": p.favorite.unwrap_or(true) }))
            .await
    }

    #[tool(
        description = "Undo the latest change an agent made this session (playlists created, renamed, filled, emptied or deleted; favourites). Call again for the one before.",
        annotations(
            title = "Undo the last change",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn undo_last_change(&self, peer: Peer<RoleServer>) -> Result<Json<Value>, String> {
        call(&peer, "library.undo", json!({})).await
    }

    #[tool(
        description = "Save a song's lyrics in Nemora's library as the user's own (they win over found ones). The music file is not changed.",
        annotations(
            title = "Save lyrics",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn save_lyrics(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<SaveLyrics>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.lyrics_save", json!({ "songId": ids(&[p.song_id])[0], "text": p.text })).await
    }

    #[tool(
        description = "Make a version of a song: a row of its own with another sound (speed in semitones, keep pitch, reverb), like Nemora's Make version. Example Slowed + Reverb: {\"semitones\": -2, \"reverb\": 0.35}. The file is not changed.",
        annotations(
            title = "Make a version",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn create_version(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<CreateVersion>,
    ) -> Result<Json<Value>, String> {
        let params = json!({
            "songId": ids(&[p.song_id])[0], "name": p.name, "semitones": p.semitones.unwrap_or(0.0),
            "keepPitch": p.keep_pitch.unwrap_or(false), "reverb": p.reverb.unwrap_or(0.0), "size": p.size.unwrap_or_else(|| "hall".into()),
        });
        call(&peer, "library.version_create", params).await
    }

    #[tool(
        description = "Switch version: give a song its own sound (no second row), or with no `sound` back to the original. Kept in the library; with write_file at the full level, also in the song's own tag field.",
        annotations(
            title = "Switch version",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn switch_version(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<SwitchVersion>,
    ) -> Result<Json<Value>, String> {
        let sound = p.sound.map(|s| json!({ "semitones": s.semitones, "keepPitch": s.keep_pitch, "reverb": s.reverb, "size": s.size.unwrap_or_else(|| "hall".into()) }));
        call(
            &peer,
            "library.switch_version",
            json!({ "songId": ids(&[p.song_id])[0], "sound": sound, "writeFile": p.write_file.unwrap_or(false) }),
        )
        .await
    }

    #[tool(
        description = "Rescan the music folders now (new, changed and removed files). Usually not needed: Nemora watches its folders.",
        annotations(
            title = "Rescan the library",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn rescan_library(&self, peer: Peer<RoleServer>) -> Result<Json<Value>, String> {
        call(&peer, "library.rescan", json!({})).await
    }

    #[tool(
        description = "Look at a public Spotify playlist by its link and find its tracks in the library (exact, likely, missing), without changing anything. Spotify shows the first 100 tracks only.",
        annotations(title = "Preview a Spotify playlist", read_only_hint = true, open_world_hint = true)
    )]
    async fn preview_spotify_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<SpotifyLink>,
    ) -> Result<Json<Value>, String> {
        call(&peer, "library.spotify_preview", json!({ "link": p.link })).await
    }

    #[tool(
        description = "Make a Nemora playlist from a public Spotify playlist's link: its tracks found in the library (likely matches too unless include_likely is false). Returns the new playlist and what was missing.",
        annotations(
            title = "Import a Spotify playlist",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn import_spotify_playlist(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<ImportSpotify>,
    ) -> Result<Json<Value>, String> {
        let preview = call(&peer, "library.spotify_preview", json!({ "link": p.link })).await?.0;
        let likely = p.include_likely.unwrap_or(true);
        let mut chosen: Vec<String> = Vec::new();
        let mut missing = Vec::new();
        for track in preview["tracks"].as_array().into_iter().flatten() {
            let ok = match track["confidence"].as_str() {
                Some("exact") => true,
                Some("likely") => likely,
                _ => false,
            };
            match track["songId"].as_str() {
                Some(id) if ok => {
                    if !chosen.iter().any(|c| c == id) {
                        chosen.push(id.to_owned());
                    }
                }
                _ => missing.push(format!(
                    "{} — {}",
                    track["title"].as_str().unwrap_or(""),
                    track["artists"]
                        .as_array()
                        .map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
                        .unwrap_or_default()
                )),
            }
        }
        if chosen.is_empty() {
            return Err(format!("None of the {} tracks is in the library.", missing.len()));
        }
        let name = p.name.unwrap_or_else(|| preview["name"].as_str().unwrap_or("Spotify playlist").to_owned());
        let made = call(&peer, "library.playlist_create", json!({ "name": name, "songIds": chosen })).await?.0;
        Ok(Json(
            json!({ "playlist": made, "songs": chosen.len(), "missing": missing, "mayBeCut": preview["mayBeCut"] }),
        ))
    }

    #[tool(
        description = "A pair of songs for a duel, as Nemora picks them (songs whose rating is least sure). Ask the user which they prefer, then submit_duel; never decide for them.",
        annotations(title = "Get a duel", read_only_hint = true, open_world_hint = false)
    )]
    async fn get_duel(&self, peer: Peer<RoleServer>) -> Result<Json<Value>, String> {
        call(&peer, "library.duel_pair", json!({})).await
    }

    #[tool(
        description = "Record the user's choice in a duel: which of two songs they prefer. Only with the user's own answer; it changes Smart Shuffle and the ratings.",
        annotations(
            title = "Submit a duel",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn submit_duel(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<SubmitDuel>,
    ) -> Result<Json<Value>, String> {
        call(
            &peer,
            "library.duel_submit",
            json!({ "songAId": p.song_a_id, "songBId": p.song_b_id, "winnerId": p.winner_id }),
        )
        .await
    }

    // ----- the user's files (full level) -------------------------------------------------------

    #[tool(
        description = "Change a song's tags in its file (title, artists, albumArtists, album, genres, year, trackNumber, composer). By default a dry run: shows before and after and changes nothing. With dry_run: false it writes the file, which needs the user's `full` level; show the user the dry run first. The audio and the song's statistics are kept.",
        annotations(
            title = "Edit tags",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn edit_tags(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<EditTags>,
    ) -> Result<Json<Value>, String> {
        call(
            &peer,
            "files.tags",
            json!({ "songId": ids(&[p.song_id])[0], "changes": p.changes, "dryRun": p.dry_run.unwrap_or(true) }),
        )
        .await
    }

    #[tool(
        description = "Move songs' files to the Windows recycle bin (never deleted for good). Needs the `full` level and confirm: true after the user agreed to the exact list.",
        annotations(
            title = "Delete songs",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn delete_songs(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<DeleteSongs>,
    ) -> Result<Json<Value>, String> {
        if !p.confirm {
            return Err("Deleting needs confirm: true, after the user agreed to the list.".into());
        }
        call(&peer, "files.delete", json!({ "songIds": ids(&p.song_ids), "confirm": true })).await
    }
}

pub fn router() -> ToolRouter<Nemora> {
    Nemora::library_router()
}
