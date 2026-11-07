//! The running Nemora's door (`apps/desktop/src-tauri/src/agent.rs`): a named pipe, one JSON line
//! each way per call. When the app is not running and the call needs it, Nemora is started.

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// The app's pipe name, as the app derives it (`agent::pipe_name`).
pub fn name() -> String {
    match std::env::var("NEMORA_AGENT_PIPE") {
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

/// `nemora.exe` beside this program (the installer puts them together), or `NEMORA_APP_EXE`.
fn app_exe() -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("NEMORA_APP_EXE") {
        return Some(path.into());
    }
    let path = std::env::current_exe().ok()?.parent()?.join("nemora.exe");
    path.exists().then_some(path)
}

#[cfg(windows)]
async fn open() -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = name();
    let started = Instant::now();
    loop {
        match ClientOptions::new().open(&name) {
            Ok(client) => return Ok(client),
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && started.elapsed() < Duration::from_secs(5) => {
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

pub async fn running() -> bool {
    #[cfg(windows)]
    {
        open().await.is_ok()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Calls the app; starts it first when it is not running and `start` allows.
pub async fn call(method: &str, params: Value, agent: &str, start: bool) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let mut client = match open().await {
            Ok(client) => client,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if !start {
                    return Err("Nemora is not running. Ask the user to open it, or call a tool that starts it.".into());
                }
                let exe = app_exe().ok_or("Nemora is not running and nemora.exe was not found beside nemora-mcp.exe; ask the user to open it.")?;
                std::process::Command::new(&exe).spawn().map_err(|e| format!("Nemora could not be started: {e}"))?;
                let started = Instant::now();
                loop {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    match open().await {
                        Ok(client) => break client,
                        Err(_) if started.elapsed() < Duration::from_secs(40) => {}
                        Err(_) => return Err("Nemora was started but did not answer within 40 s.".into()),
                    }
                }
            }
            Err(e) => return Err(format!("Nemora's door did not open: {e}")),
        };
        let request = json!({ "id": 1, "method": method, "params": params, "agent": agent });
        let (read, mut write) = tokio::io::split(&mut client);
        write.write_all(format!("{request}\n").as_bytes()).await.map_err(|e| e.to_string())?;
        write.flush().await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(read).read_line(&mut line).await.map_err(|e| e.to_string())?;
        let reply: Value =
            serde_json::from_str(&line).map_err(|e| format!("Nemora answered something unreadable: {e}"))?;
        match reply.get("error").and_then(Value::as_str) {
            Some(error) => Err(error.to_owned()),
            None => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (method, params, agent, start);
        Err("Nemora's door exists on Windows only.".into())
    }
}
