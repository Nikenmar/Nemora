//! Setting nemora-mcp up in an agent (PLAN/22 P22.5), from Settings: the agent's own config file
//! gets one entry, `nemora`, and nothing else changes. The file is read first; one that cannot be
//! read as its format (JSON with comments, broken TOML) is left alone and the user is given the
//! entry to paste. A file that existed is copied beside itself before it changes.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};

use crate::commands::{Res, fail};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct AgentTarget {
    pub id: String,
    pub name: String,
    /// Where its config lives, or the command that sets it up.
    pub place: String,
    /// The agent seems to be installed here.
    pub detected: bool,
    /// Nemora is already in its config.
    pub configured: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(specta::Type))]
pub struct SetupDone {
    pub file: String,
    /// The copy of the file as it was, when there was one.
    pub backup: Option<String>,
    /// It was set up already: nothing changed.
    pub already: bool,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

fn roaming() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default()
}

/// The JSON file, the key holding servers, and the entry for one agent.
fn json_target(id: &str, mcp: &str) -> Option<(PathBuf, &'static str, Value)> {
    Some(match id {
        "claude_desktop" => (
            roaming().join("Claude").join("claude_desktop_config.json"),
            "mcpServers",
            json!({ "command": mcp, "args": [] }),
        ),
        "cursor" => (home().join(".cursor").join("mcp.json"), "mcpServers", json!({ "command": mcp, "args": [] })),
        "vscode" => (
            roaming().join("Code").join("User").join("mcp.json"),
            "servers",
            json!({ "type": "stdio", "command": mcp, "args": [] }),
        ),
        "gemini" => (home().join(".gemini").join("settings.json"), "mcpServers", json!({ "command": mcp, "args": [] })),
        _ => return None,
    })
}

fn codex_file() -> PathBuf {
    home().join(".codex").join("config.toml")
}

const CODEX_HEADER: &str = "[mcp_servers.nemora]";

fn codex_entry(mcp: &str) -> String {
    // A literal TOML string: Windows paths keep their backslashes.
    format!("{CODEX_HEADER}\ncommand = '{mcp}'\nargs = []\n")
}

fn backup(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".nemora-backup-{stamp}"));
    let copy = path.with_file_name(name);
    std::fs::copy(path, &copy).map_err(|e| format!("{} could not be backed up: {e}", path.display()))?;
    Ok(Some(copy.display().to_string()))
}

fn read_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("{} could not be read: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        format!("{} is not plain JSON (comments?), so Nemora leaves it alone: add the entry by hand.", path.display())
    })?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(format!("{} is not a JSON object; add the entry by hand.", path.display()))
    }
}

/// The `[mcp_servers.nemora]` table's lines, if the file has one.
fn codex_has(text: &str) -> Option<String> {
    let start = text.find(CODEX_HEADER)?;
    let rest = &text[start + CODEX_HEADER.len()..];
    let end = rest.find("\n[").map_or(rest.len(), |i| i + 1);
    Some(text[start..start + CODEX_HEADER.len() + end].to_owned())
}

fn configured(id: &str, mcp: &str) -> bool {
    match id {
        "codex" => std::fs::read_to_string(codex_file())
            .ok()
            .and_then(|t| codex_has(&t))
            .is_some_and(|block| block.contains(mcp)),
        "claude_code" => std::fs::read_to_string(home().join(".claude.json"))
            .ok()
            .is_some_and(|t| t.contains("\"nemora\"") && t.contains(&mcp.replace('\\', "\\\\"))),
        other => json_target(other, mcp).is_some_and(|(path, key, entry)| {
            read_json(&path).ok().is_some_and(|v| v.get(key).and_then(|s| s.get("nemora")) == Some(&entry))
        }),
    }
}

/// Every agent Nemora can set up, whether it is here and whether it is set up.
pub fn targets(mcp: &str) -> Vec<AgentTarget> {
    let claude_cli = which("claude");
    let list: Vec<(&str, &str, String, bool)> = vec![
        (
            "claude_code",
            "Claude Code",
            format!("claude mcp add --scope user nemora -- \"{mcp}\""),
            claude_cli.is_some(),
        ),
        (
            "claude_desktop",
            "Claude Desktop",
            json_target("claude_desktop", mcp).unwrap().0.display().to_string(),
            roaming().join("Claude").exists(),
        ),
        ("codex", "Codex", codex_file().display().to_string(), home().join(".codex").exists()),
        (
            "cursor",
            "Cursor",
            json_target("cursor", mcp).unwrap().0.display().to_string(),
            home().join(".cursor").exists(),
        ),
        (
            "vscode",
            "VS Code",
            json_target("vscode", mcp).unwrap().0.display().to_string(),
            roaming().join("Code").exists(),
        ),
        (
            "gemini",
            "Gemini CLI",
            json_target("gemini", mcp).unwrap().0.display().to_string(),
            home().join(".gemini").exists(),
        ),
    ];
    list.into_iter()
        .map(|(id, name, place, detected)| AgentTarget {
            id: id.into(),
            name: name.into(),
            place,
            detected,
            configured: configured(id, mcp),
        })
        .collect()
}

fn which(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        ["exe", "cmd", "bat"].iter().map(|ext| dir.join(format!("{program}.{ext}"))).find(|p| p.exists())
    })
}

pub fn setup(id: &str, mcp: &str) -> Result<SetupDone, String> {
    if id == "claude_code" {
        let claude = which("claude").ok_or("Claude Code (claude) is not on PATH; copy the command instead.")?;
        if configured(id, mcp) {
            return Ok(SetupDone { file: "~/.claude.json".into(), backup: None, already: true });
        }
        let mut command = if claude.extension().is_some_and(|e| e != "exe") {
            let mut c = std::process::Command::new("cmd");
            c.arg("/C").arg(&claude);
            c
        } else {
            std::process::Command::new(&claude)
        };
        let output = command.args(["mcp", "add", "--scope", "user", "nemora", "--", mcp]).output().map_err(fail)?;
        let said = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        if !output.status.success() {
            if said.contains("already exists") {
                return Ok(SetupDone { file: "~/.claude.json".into(), backup: None, already: true });
            }
            return Err(format!("claude mcp add failed: {}", said.trim()));
        }
        return Ok(SetupDone { file: "~/.claude.json (claude mcp add)".into(), backup: None, already: false });
    }
    if id == "codex" {
        let path = codex_file();
        let text = if path.exists() { std::fs::read_to_string(&path).map_err(fail)? } else { String::new() };
        let entry = codex_entry(mcp);
        let new = match codex_has(&text) {
            Some(block) if block.trim_end() == entry.trim_end() => {
                return Ok(SetupDone { file: path.display().to_string(), backup: None, already: true });
            }
            Some(block) => text.replacen(&block, &format!("{entry}\n"), 1),
            None => {
                let sep = if text.is_empty() || text.ends_with("\n\n") {
                    ""
                } else if text.ends_with('\n') {
                    "\n"
                } else {
                    "\n\n"
                };
                format!("{text}{sep}{entry}")
            }
        };
        let backup = backup(&path)?;
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(fail)?;
        std::fs::write(&path, new).map_err(fail)?;
        return Ok(SetupDone { file: path.display().to_string(), backup, already: false });
    }
    let (path, key, entry) = json_target(id, mcp).ok_or_else(|| format!("Nemora does not know the agent `{id}`."))?;
    let mut value = read_json(&path)?;
    if value.get(key).and_then(|s| s.get("nemora")) == Some(&entry) {
        return Ok(SetupDone { file: path.display().to_string(), backup: None, already: true });
    }
    let servers = value.as_object_mut().unwrap().entry(key).or_insert_with(|| json!({}));
    if !servers.is_object() {
        return Err(format!("`{key}` in {} is not an object; add the entry by hand.", path.display()));
    }
    servers.as_object_mut().unwrap().insert("nemora".into(), entry);
    let backup = backup(&path)?;
    std::fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(fail)?;
    std::fs::write(&path, serde_json::to_string_pretty(&value).map_err(fail)? + "\n").map_err(fail)?;
    Ok(SetupDone { file: path.display().to_string(), backup, already: false })
}

fn mcp_or_error() -> Result<String, String> {
    crate::agent::mcp_path().map(|p| p.display().to_string()).ok_or_else(|| {
        "nemora-mcp.exe is not beside Nemora (a development build); install Nemora to set agents up.".to_owned()
    })
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_targets() -> Res<Vec<AgentTarget>> {
    Ok(crate::agent::mcp_path().map(|p| targets(&p.display().to_string())).unwrap_or_default())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn agent_setup(target: String) -> Res<SetupDone> {
    let mcp = mcp_or_error()?;
    tauri::async_runtime::spawn_blocking(move || setup(&target, &mcp)).await.map_err(fail)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_codex_config_gets_one_table_and_keeps_the_rest() {
        let mcp = r"C:\Users\me\AppData\Local\Nemora\nemora-mcp.exe";
        let text = "model = \"o3\"\n\n[mcp_servers.other]\ncommand = \"x\"\n";
        assert!(codex_has(text).is_none());
        let with = format!("{text}\n{}", codex_entry(mcp));
        let block = codex_has(&with).unwrap();
        assert!(block.contains(r"command = 'C:\Users\me\AppData\Local\Nemora\nemora-mcp.exe'"));
        assert!(with.contains("[mcp_servers.other]"), "the other server stays");
        // A table followed by another: only its own lines.
        let middle = format!("{}\n[mcp_servers.after]\ncommand = \"y\"\n", codex_entry("old"));
        assert!(!codex_has(&middle).unwrap().contains("after"));
    }
}
