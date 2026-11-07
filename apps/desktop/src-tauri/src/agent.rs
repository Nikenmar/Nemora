//! The agents' door (PLAN/22): a named pipe the MCP server (`nemora-mcp.exe`) talks to while the
//! app runs. One JSON line in, one JSON line out per connection:
//! `{"id":1,"method":"view.play","params":{...},"agent":"claude-code"}` ->
//! `{"id":1,"result":...}` or `{"id":1,"error":"..."}`.
//!
//! - **Local only, this user**: the pipe refuses remote clients and is named after the user.
//! - **The app decides**: every method has an access level, checked here against the user's setting
//!   (`agent.access`: off, read, control - the default -, full); an agent cannot raise it.
//! - **The view acts** for what lives there (playback, the queue, pages): the request goes to the
//!   webview as an event, which answers through `agent_reply`.
//! - **A log** (`agent.log`, the latest 200) of what agents changed, shown in Settings.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

use crate::app::App;
use crate::commands::{Res, fail};

/// Overrides the pipe's name (tests and the stand, which must not take the user's).
pub const PIPE_ENV: &str = "NEMORA_AGENT_PIPE";
const ACCESS_KEY: &str = "agent.access";
const LOG_KEY: &str = "agent.log";
const LOG_LIMIT: usize = 200;
const VIEW_TIMEOUT: Duration = Duration::from_secs(10);
/// `view.wait_change` may wait this long for the song to change.
const WAIT_LIMIT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Off,
    Read,
    Control,
    Full,
}

impl Level {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "read" => Some(Self::Read),
            "control" => Some(Self::Control),
            "full" => Some(Self::Full),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Read => "read",
            Self::Control => "control",
            Self::Full => "full",
        }
    }
}

/// What a method needs; `None`: no such method.
pub fn level_of(method: &str) -> Option<Level> {
    Some(match method {
        "app.status" | "view.now" | "view.queue" | "view.wait_change" => Level::Read,
        "view.play" | "view.pause" | "view.resume" | "view.next" | "view.previous" | "view.seek" | "view.volume"
        | "view.mute" | "view.repeat" | "view.shuffle" | "view.queue_add" | "view.queue_remove" | "view.queue_move"
        | "view.queue_clear" | "view.open" | "view.notify" => Level::Control,
        other => return crate::agent_library::level_of(other),
    })
}

pub fn pipe_name() -> String {
    match std::env::var(PIPE_ENV) {
        Ok(name) if !name.trim().is_empty() => format!(r"\\.\pipe\{}", name.trim()),
        _ => {
            let user: String = std::env::var("USERNAME")
                .unwrap_or_default()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                .collect();
            format!(r"\\.\pipe\nemora-agent-{user}")
        }
    }
}

#[derive(Default)]
pub struct Agents {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
}

pub fn access(app: &App) -> Level {
    nemora_core::settings::device(&app.read(), ACCESS_KEY)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().and_then(Level::parse))
        .unwrap_or(Level::Control)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct LogEntry {
    /// Milliseconds since the epoch.
    pub at: f64,
    pub agent: String,
    pub method: String,
    /// What it did, in a few words.
    pub detail: String,
}

fn log(app: &App, agent: &str, method: &str, params: &Value) {
    let detail = summary(method, params);
    let entry = LogEntry { at: now_ms() as f64, agent: agent.to_owned(), method: method.to_owned(), detail };
    let _ = app.write_quiet(|db| {
        let mut list: Vec<LogEntry> = nemora_core::settings::device(db, LOG_KEY)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        list.push(entry);
        if list.len() > LOG_LIMIT {
            let extra = list.len() - LOG_LIMIT;
            list.drain(..extra);
        }
        nemora_core::settings::set_device(db, LOG_KEY, &serde_json::to_value(&list).unwrap_or(Value::Null))
    });
}

/// A line for the log: the method's arguments, short.
fn summary(method: &str, params: &Value) -> String {
    let text = params.to_string();
    let text =
        if text.chars().count() > 160 { format!("{}…", text.chars().take(160).collect::<String>()) } else { text };
    match text.as_str() {
        "null" | "{}" => method.to_owned(),
        _ => format!("{method} {text}"),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[derive(Debug, Deserialize)]
struct Request {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    agent: Option<String>,
}

/// Opens the door. A stand or bench run opens it only under its own name (`NEMORA_AGENT_PIPE`).
pub fn start(handle: &AppHandle) {
    if crate::bench::dir().is_some() && std::env::var_os(PIPE_ENV).is_none() {
        return;
    }
    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve(handle).await {
            log::warn!("the agents' pipe is closed: {error}");
        }
    });
}

#[cfg(windows)]
async fn serve(handle: AppHandle) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = pipe_name();
    // The first instance: another program holding the name is never served in its place.
    let mut server = ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(&name)?;
    loop {
        server.connect().await?;
        let client = server;
        server = ServerOptions::new().reject_remote_clients(true).create(&name)?;
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            let (read, mut write) = tokio::io::split(client);
            let mut line = String::new();
            if BufReader::new(read).read_line(&mut line).await.unwrap_or(0) == 0 {
                return;
            }
            let reply = match serde_json::from_str::<Request>(&line) {
                Ok(request) => {
                    let id = request.id.clone();
                    match dispatch(&handle, request).await {
                        Ok(result) => json!({ "id": id, "result": result }),
                        Err(error) => json!({ "id": id, "error": error }),
                    }
                }
                Err(error) => json!({ "id": Value::Null, "error": format!("not a request: {error}") }),
            };
            let _ = write.write_all(format!("{reply}\n").as_bytes()).await;
            let _ = write.flush().await;
        });
    }
}

#[cfg(not(windows))]
async fn serve(_handle: AppHandle) -> std::io::Result<()> {
    Ok(())
}

async fn dispatch(handle: &AppHandle, request: Request) -> Result<Value, String> {
    let app = handle.state::<App>();
    let need = level_of(&request.method).ok_or_else(|| format!("Nemora knows no method `{}`.", request.method))?;
    let allowed = access(&app);
    if allowed < need {
        return Err(match allowed {
            Level::Off => "The user has turned agents off in Nemora (Settings, AI agents).".to_owned(),
            _ => format!(
                "Nemora lets agents {} only; this needs `{}`. The user can change it in Settings, AI agents.",
                allowed.name(),
                need.name()
            ),
        });
    }
    let agent = request.agent.clone().unwrap_or_else(|| "an agent".to_owned());
    let result = match request.method.as_str() {
        "app.status" => Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "access": allowed.name() })),
        method if method.starts_with("view.") => {
            ask_view(handle, &method["view.".len()..], &request.params, &agent).await
        }
        method if method.starts_with("library.") || method.starts_with("files.") => {
            crate::agent_library::run(handle, method, &request.params, allowed).await
        }
        other => Err(format!("`{other}` is not served yet.")),
    }?;
    // A dry run changes nothing; a write that went through is logged whatever its method's level.
    let wrote = result.get("dryRun") == Some(&Value::Bool(false));
    if need >= Level::Control || wrote {
        log(&app, &agent, &request.method, &request.params);
    }
    Ok(result)
}

/// Asks the view, which owns playback, the queue and the pages.
async fn ask_view(handle: &AppHandle, method: &str, params: &Value, agent: &str) -> Result<Value, String> {
    let agents = handle.state::<Agents>();
    let id = agents.next.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel();
    agents.waiting.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
    let timeout = if method == "wait_change" {
        let asked = params.get("timeoutSeconds").and_then(Value::as_f64).unwrap_or(120.0).clamp(1.0, 600.0);
        Duration::from_secs_f64(asked + 5.0).min(WAIT_LIMIT)
    } else {
        VIEW_TIMEOUT
    };
    handle
        .emit("nemora://agent-request", json!({ "requestId": id, "method": method, "params": params, "agent": agent }))
        .map_err(|e| e.to_string())?;
    let answer = tokio::time::timeout(timeout, rx).await;
    agents.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    match answer {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Nemora's window closed before it answered.".to_owned()),
        Err(_) => Err("Nemora's window did not answer in time.".to_owned()),
    }
}

/// The view's answer to an agent's request.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_reply(
    agents: State<'_, Agents>,
    request_id: f64,
    result: Option<Value>,
    error: Option<String>,
) -> Res<()> {
    let sender = agents.waiting.lock().unwrap_or_else(|e| e.into_inner()).remove(&(request_id as u64));
    if let Some(sender) = sender {
        let _ = sender.send(match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct AgentSettings {
    /// off, read, control or full.
    pub access: String,
    /// `nemora-mcp.exe` beside the app, when it is there.
    pub mcp_path: Option<String>,
    pub pipe: String,
    /// What agents did, newest first.
    pub log: Vec<LogEntry>,
}

pub fn mcp_path() -> Option<std::path::PathBuf> {
    // The installer puts it beside nemora.exe; a development build finds the one cargo built there.
    let path = std::env::current_exe().ok()?.parent()?.join("nemora-mcp.exe");
    path.exists().then_some(path)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_settings(app: State<'_, App>) -> Res<AgentSettings> {
    let mut log: Vec<LogEntry> = nemora_core::settings::device(&app.read(), LOG_KEY)
        .map_err(fail)?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    log.reverse();
    Ok(AgentSettings {
        access: access(&app).name().to_owned(),
        mcp_path: mcp_path().map(|p| p.display().to_string()),
        pipe: pipe_name(),
        log,
    })
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_set_access(app: State<'_, App>, access: String) -> Res<()> {
    let level = Level::parse(&access).ok_or_else(|| fail("access is off, read, control or full"))?;
    app.write_quiet(|db| nemora_core::settings::set_device(db, ACCESS_KEY, &Value::from(level.name()))).map_err(fail)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_log_clear(app: State<'_, App>) -> Res<()> {
    app.write_quiet(|db| nemora_core::settings::set_device(db, LOG_KEY, &json!([]))).map_err(fail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_order_and_every_method_has_one() {
        assert!(Level::Off < Level::Read && Level::Read < Level::Control && Level::Control < Level::Full);
        assert_eq!(level_of("view.now"), Some(Level::Read));
        assert_eq!(level_of("view.play"), Some(Level::Control));
        assert_eq!(level_of("delete.everything"), None);
        for name in ["off", "read", "control", "full"] {
            assert_eq!(Level::parse(name).map(Level::name), Some(name));
        }
    }

    #[test]
    fn a_log_line_is_short() {
        let long = json!({ "songIds": vec!["abcdefghijklmnopqrstuvwxyz"; 20] });
        assert!(summary("view.play", &long).chars().count() < 200);
        assert_eq!(summary("view.pause", &json!({})), "view.pause");
    }
}
