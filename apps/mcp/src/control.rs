//! The control tools (PLAN/22 P22.2): playback, the queue, pages and notices, done by the running
//! Nemora through its pipe. Nemora checks the user's access level for each; when it is not running,
//! a tool that needs it starts it.

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::service::RequestContext;
use rmcp::{RoleServer, tool, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::pipe;
use crate::server::{Nemora, Song, rows_for_songs, song};

/// The agent's name as its client gave it, for the user's log and notices: its title ("Claude
/// Code") when it sent one, else its name. From the request itself under MCP 2026-07-28, which has
/// no handshake (Claude Code sends `io.modelcontextprotocol/clientInfo` in every request's `_meta`),
/// else from the older protocols' `initialize`.
pub(crate) fn agent(ctx: &RequestContext<RoleServer>) -> String {
    ctx.client_info()
        .and_then(|info| info.title.filter(|t| !t.trim().is_empty()).or(Some(info.name)))
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "an agent".into())
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// `null` when nothing is loaded.
    song_id: Option<String>,
    view_id: Option<String>,
    title: Option<String>,
    artists: Vec<String>,
    album: Option<String>,
    position_seconds: f64,
    duration_seconds: f64,
    playing: bool,
    volume_percent: f64,
    muted: bool,
    /// off, all or one.
    repeat: String,
    /// off, shuffle or smart (Smart Shuffle).
    shuffle: String,
    queue_length: i64,
    queue_index: Option<i64>,
    /// Only from `wait_for_song_change`: whether the song changed before the time ran out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    changed: Option<bool>,
}

fn now(value: Value) -> Result<Json<NowPlaying>, String> {
    serde_json::from_value(value).map(Json).map_err(|e| format!("Nemora answered in an unexpected shape: {e}"))
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlayParams {
    /// The songs to play, in order: song ids or view ids from the read tools. They replace the
    /// queue.
    song_ids: Vec<String>,
    /// Start with this one (0 by default).
    #[serde(default)]
    start_index: Option<i64>,
    /// Shuffle them first.
    #[serde(default)]
    shuffle: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SeekParams {
    /// Seconds from the start of the song.
    seconds: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct VolumeParams {
    /// 0 to 100.
    percent: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MuteParams {
    muted: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode {
    Off,
    /// The queue.
    All,
    /// The song.
    One,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RepeatParams {
    mode: RepeatMode,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ShuffleMode {
    Off,
    Shuffle,
    /// Smart Shuffle: an order weighted by the user's tiers, duels and listening.
    Smart,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ShuffleParams {
    mode: ShuffleMode,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueueParams {
    /// Rows to skip (0 by default).
    #[serde(default)]
    offset: Option<i64>,
    /// Rows to return (default 50, at most 500).
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueueOut {
    /// The playing song's position.
    current_index: Option<i64>,
    total: i64,
    /// Each with its position in the queue.
    songs: Vec<QueueSong>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct QueueSong {
    position: i64,
    #[serde(flatten)]
    song: Song,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueueAddParams {
    song_ids: Vec<String>,
    /// Right after the playing song instead of at the end.
    #[serde(default)]
    next: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueueRemoveParams {
    /// Positions from `get_queue`; the playing song cannot be removed.
    positions: Vec<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueueMoveParams {
    from: i64,
    to: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Page {
    Home,
    Songs,
    Albums,
    Artists,
    Playlists,
    Genres,
    Queue,
    Lyrics,
    Stats,
    TasteMap,
    Tierlists,
    Settings,
    /// Needs `id`: a song id.
    Song,
    /// Needs `id`: an album key.
    Album,
    /// Needs `id`: the artist's name.
    Artist,
    /// Needs `id`: the genre's name.
    Genre,
    /// Needs `id`: a playlist id.
    Playlist,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OpenParams {
    page: Page,
    #[serde(default)]
    id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NotifyParams {
    /// Shown in Nemora for a few seconds, after the agent's name (200 characters at most).
    text: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WaitParams {
    /// Give up after this many seconds (default 120, at most 600).
    #[serde(default)]
    timeout_seconds: Option<f64>,
    /// Wait for a change away from this song (the playing one by default).
    #[serde(default)]
    from_song_id: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct AppStatus {
    running: bool,
    /// What the user lets agents do: off, read, control or full.
    access: Option<String>,
    version: Option<String>,
}

fn page_name(page: &Page) -> &'static str {
    match page {
        Page::Home => "home",
        Page::Songs => "songs",
        Page::Albums => "albums",
        Page::Artists => "artists",
        Page::Playlists => "playlists",
        Page::Genres => "genres",
        Page::Queue => "queue",
        Page::Lyrics => "lyrics",
        Page::Stats => "stats",
        Page::TasteMap => "taste_map",
        Page::Tierlists => "tierlists",
        Page::Settings => "settings",
        Page::Song => "song",
        Page::Album => "album",
        Page::Artist => "artist",
        Page::Genre => "genre",
        Page::Playlist => "playlist",
    }
}

#[tool_router(router = control_router, vis = "pub(crate)")]
impl Nemora {
    #[tool(
        description = "Whether Nemora is running, what the user lets agents do (off, read, control, full) and its version. Reading the library works without the app; playing and changing things need it running (those tools start it when it is not).",
        annotations(title = "App status", read_only_hint = true, open_world_hint = false)
    )]
    async fn app_status(&self, ctx: RequestContext<RoleServer>) -> Result<Json<AppStatus>, String> {
        if !pipe::running().await {
            return Ok(Json(AppStatus { running: false, access: None, version: None }));
        }
        let status = pipe::call("app.status", json!({}), &agent(&ctx), false).await?;
        Ok(Json(AppStatus {
            running: true,
            access: status.get("access").and_then(Value::as_str).map(str::to_owned),
            version: status.get("version").and_then(Value::as_str).map(str::to_owned),
        }))
    }

    #[tool(
        description = "What Nemora is playing right now: the song (ids, title, artists, album), position and length in seconds, playing or paused, volume, mute, repeat (off/all/one), shuffle (off/shuffle/smart), and the queue's length and position.",
        annotations(title = "Now playing", read_only_hint = true, open_world_hint = false)
    )]
    async fn now_playing(&self, ctx: RequestContext<RoleServer>) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.now", json!({}), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Play songs now: they replace the queue, in the order given (or shuffled), starting at `start_index`. Use ids from search, list_songs, get_playlist, stats_dashboard. Starts Nemora if it is not running. Example: {\"song_ids\": [\"<id>\", \"<id>\"]}. To play a whole playlist or album, list its songs first.",
        annotations(
            title = "Play",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn play(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<PlayParams>,
    ) -> Result<Json<NowPlaying>, String> {
        if p.song_ids.is_empty() {
            return Err("song_ids is empty: find songs with search or list_songs first.".into());
        }
        let params = json!({ "songIds": p.song_ids, "startIndex": p.start_index.unwrap_or(0), "shuffle": p.shuffle.unwrap_or(false) });
        now(pipe::call("view.play", params, &agent(&ctx), true).await?)
    }

    #[tool(
        description = "Pause playback; the position is kept. Returns what is playing (now paused).",
        annotations(
            title = "Pause",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn pause(&self, ctx: RequestContext<RoleServer>) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.pause", json!({}), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Resume playback of the current song from where it paused; starts Nemora if needed. Returns what plays.",
        annotations(
            title = "Resume",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn resume(&self, ctx: RequestContext<RoleServer>) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.resume", json!({}), &agent(&ctx), true).await?)
    }

    #[tool(
        description = "Skip to the next song in the queue. Counts as a skip of the current song in the user's statistics, as a press of Next would.",
        annotations(
            title = "Next song",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn next_song(&self, ctx: RequestContext<RoleServer>) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.next", json!({}), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Back to the previous song; past the first 5 seconds of a song, back to its start (as the button does).",
        annotations(
            title = "Previous song",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn previous_song(&self, ctx: RequestContext<RoleServer>) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.previous", json!({}), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Jump to a position in the playing song, in seconds from its start. Returns what plays and where.",
        annotations(
            title = "Seek",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn seek(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<SeekParams>,
    ) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.seek", json!({ "seconds": p.seconds }), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Set Nemora's volume, 0 to 100 (the app's own slider, not Windows').",
        annotations(
            title = "Set volume",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn set_volume(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<VolumeParams>,
    ) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.volume", json!({ "percent": p.percent }), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Mute or unmute Nemora (its own mute, not Windows'). Returns what plays.",
        annotations(
            title = "Mute",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn set_muted(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<MuteParams>,
    ) -> Result<Json<NowPlaying>, String> {
        now(pipe::call("view.mute", json!({ "muted": p.muted }), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Set repeat: off, all (the whole queue) or one (the current song over and over). Returns what plays.",
        annotations(
            title = "Repeat",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn set_repeat(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<RepeatParams>,
    ) -> Result<Json<NowPlaying>, String> {
        let mode = match p.mode {
            RepeatMode::Off => "off",
            RepeatMode::All => "all",
            RepeatMode::One => "one",
        };
        now(pipe::call("view.repeat", json!({ "mode": mode }), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "Shuffle: off, shuffle (random order) or smart (Smart Shuffle: weighted by the user's tiers, duels, listening and the hour). Reorders the current queue.",
        annotations(
            title = "Shuffle",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn set_shuffle(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<ShuffleParams>,
    ) -> Result<Json<NowPlaying>, String> {
        let mode = match p.mode {
            ShuffleMode::Off => "off",
            ShuffleMode::Shuffle => "shuffle",
            ShuffleMode::Smart => "smart",
        };
        now(pipe::call("view.shuffle", json!({ "mode": mode }), &agent(&ctx), false).await?)
    }

    #[tool(
        description = "The queue: each song with its position, and the playing song's position. Paged (default 50 from the start).",
        annotations(title = "Get the queue", read_only_hint = true, open_world_hint = false)
    )]
    async fn get_queue(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<QueueParams>,
    ) -> Result<Json<QueueOut>, String> {
        let queue = pipe::call("view.queue", json!({}), &agent(&ctx), false).await?;
        let ids: Vec<String> =
            queue.get("songIds").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
        let current = queue.get("currentIndex").and_then(Value::as_i64);
        let offset = p.offset.unwrap_or(0).max(0) as usize;
        let limit = p.limit.unwrap_or(50).clamp(1, 500) as usize;
        let page: Vec<String> = ids.iter().skip(offset).take(limit).cloned().collect();
        let db = self.db()?;
        let rows = rows_for_songs(&db, &page)?;
        let by: std::collections::HashMap<&str, &nemora_core::library::SongRow> =
            rows.iter().map(|r| (r.song_id.as_str(), r)).collect();
        let songs = page
            .iter()
            .enumerate()
            .filter_map(|(i, id)| {
                by.get(id.as_str()).map(|r| QueueSong { position: (offset + i) as i64, song: song(r) })
            })
            .collect();
        Ok(Json(QueueOut { current_index: current, total: ids.len() as i64, songs }))
    }

    #[tool(
        description = "Add songs to the queue: at the end, or with `next: true` right after the playing song.",
        annotations(
            title = "Add to the queue",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn queue_add(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<QueueAddParams>,
    ) -> Result<Json<Value>, String> {
        let ids: Vec<String> = p.song_ids.iter().map(|id| id.split(':').next().unwrap_or(id).to_owned()).collect();
        pipe::call("view.queue_add", json!({ "songIds": ids, "next": p.next.unwrap_or(false) }), &agent(&ctx), true)
            .await
            .map(Json)
    }

    #[tool(
        description = "Remove songs from the queue by their positions (from get_queue). The playing song stays.",
        annotations(
            title = "Remove from the queue",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn queue_remove(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<QueueRemoveParams>,
    ) -> Result<Json<Value>, String> {
        pipe::call("view.queue_remove", json!({ "positions": p.positions }), &agent(&ctx), false).await.map(Json)
    }

    #[tool(
        description = "Move one song in the queue from one position to another.",
        annotations(
            title = "Move in the queue",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn queue_move(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<QueueMoveParams>,
    ) -> Result<Json<Value>, String> {
        pipe::call("view.queue_move", json!({ "from": p.from, "to": p.to }), &agent(&ctx), false).await.map(Json)
    }

    #[tool(
        description = "Empty the queue but for the playing song.",
        annotations(
            title = "Clear the queue",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn queue_clear(&self, ctx: RequestContext<RoleServer>) -> Result<Json<Value>, String> {
        pipe::call("view.queue_clear", json!({}), &agent(&ctx), false).await.map(Json)
    }

    #[tool(
        description = "Show a page in Nemora: home, songs, albums, artists, playlists, genres, queue, lyrics, stats, taste_map, tierlists, settings; or one song (id: song id), album (id: album key), artist (id: name), genre (id: name), playlist (id: playlist id). Starts Nemora if needed.",
        annotations(
            title = "Open a page",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn open_page(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<OpenParams>,
    ) -> Result<Json<Value>, String> {
        let id = p
            .id
            .map(|id| if matches!(p.page, Page::Song) { id.split(':').next().unwrap_or(&id).to_owned() } else { id });
        pipe::call("view.open", json!({ "page": page_name(&p.page), "id": id }), &agent(&ctx), true).await.map(Json)
    }

    #[tool(
        description = "Show the user a short notice inside Nemora, after the agent's name: what you did, or what you found.",
        annotations(
            title = "Show a notice",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn show_notice(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<NotifyParams>,
    ) -> Result<Json<Value>, String> {
        pipe::call("view.notify", json!({ "text": p.text }), &agent(&ctx), false).await.map(Json)
    }

    #[tool(
        description = "Wait until the playing song changes (or the time runs out), then say what plays: for following along, or picking songs one by one as a DJ would (queue_add with next: true before this one ends).",
        annotations(title = "Wait for the next song", read_only_hint = true, open_world_hint = false)
    )]
    async fn wait_for_song_change(
        &self,
        ctx: RequestContext<RoleServer>,
        Parameters(p): Parameters<WaitParams>,
    ) -> Result<Json<NowPlaying>, String> {
        let params = json!({ "timeoutSeconds": p.timeout_seconds.unwrap_or(120.0), "fromSongId": p.from_song_id });
        now(pipe::call("view.wait_change", params, &agent(&ctx), false).await?)
    }
}

/// Both routers: the read tools and these.
pub fn router() -> ToolRouter<Nemora> {
    Nemora::read_router() + Nemora::control_router() + crate::library_tools::router()
}
