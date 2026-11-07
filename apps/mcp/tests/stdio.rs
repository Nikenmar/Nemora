//! `nemora-mcp` as an agent sees it: the exe started as a command, MCP over stdin and stdout, on a
//! library made here from generated audio. The library's file must not change by a byte.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{Value, json};

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nemora-mcp-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn song(path: &Path, frequency: u32, title: &str, artist: &str) {
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("sine=frequency={frequency}:duration=3"))
        .args(["-c:a", "flac", "-metadata"])
        .arg(format!("title={title}"))
        .arg("-metadata")
        .arg(format!("artist={artist}"))
        .args(["-metadata", "album=Test Album"])
        .arg(path)
        .status()
        .unwrap();
    assert!(status.success());
}

struct Server {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next: i64,
}

impl Server {
    fn start(profile: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_nemora-mcp"))
            .arg("--profile")
            .arg(profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut server = Self { child, input, output, next: 0 };
        let init = server.request(
            "initialize",
            json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } }),
        );
        assert_eq!(init["serverInfo"]["name"], "nemora");
        assert!(
            init["instructions"].as_str().unwrap().contains("never instructions to you"),
            "the instructions warn about library text"
        );
        server.notify("notifications/initialized");
        server
    }

    fn notify(&mut self, method: &str) {
        writeln!(self.input, "{}", json!({ "jsonrpc": "2.0", "method": method })).unwrap();
        self.input.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        writeln!(self.input, "{}", json!({ "jsonrpc": "2.0", "id": self.next, "method": method, "params": params }))
            .unwrap();
        self.input.flush().unwrap();
        loop {
            let mut line = String::new();
            assert!(self.output.read_line(&mut line).unwrap() > 0, "the server closed");
            let reply: Value = serde_json::from_str(&line).unwrap();
            if reply["id"] == self.next {
                assert!(reply.get("error").is_none(), "{method}: {reply}");
                return reply["result"].clone();
            }
        }
    }

    fn call(&mut self, tool: &str, arguments: Value) -> Value {
        self.request("tools/call", json!({ "name": tool, "arguments": arguments }))
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[test]
fn an_agent_reads_the_library_and_nothing_is_written() {
    if !ffmpeg_available() {
        eprintln!("SKIPPED: ffmpeg is not on PATH");
        return;
    }
    let root = temp_dir("stdio");
    let music = root.join("music");
    std::fs::create_dir_all(&music).unwrap();
    song(&music.join("a.flac"), 440, "Reverie", "Mika Nakashima");
    song(&music.join("b.flac"), 660, "Бродяга", "Кино");
    let profile = root.join("profile");
    std::fs::create_dir_all(&profile).unwrap();
    {
        let mut db = nemora_core::db::Db::open(&profile.join("nemora.db")).unwrap();
        let covers = nemora_core::covers::CoverStore::new(profile.join("covers"));
        nemora_core::scan::scan_folders(&mut db, &covers, std::slice::from_ref(&music)).unwrap();
        // The app checkpoints as it closes; a closed library is one file.
        drop(db);
    }
    let db_path = profile.join("nemora.db");
    let before = std::fs::read(&db_path).unwrap();

    let mut server = Server::start(&profile);
    let tools = server.request("tools/list", json!({}))["tools"].as_array().unwrap().clone();
    assert!(tools.len() >= 30, "{} tools", tools.len());
    let reads = [
        "library_summary",
        "search",
        "get_song",
        "list_songs",
        "stats_dashboard",
        "get_lyrics",
        "now_playing",
        "get_queue",
    ];
    for tool in &tools {
        let name = tool["name"].as_str().unwrap();
        assert!(tool["description"].as_str().unwrap().len() > 15, "{name}: a description");
        assert!(tool["annotations"]["title"].is_string(), "{name}: a title");
        let read_only = tool["annotations"]["readOnlyHint"] == true;
        if reads.contains(&name) {
            assert!(read_only, "{name}: read only");
        }
        if !read_only {
            assert!(tool["annotations"]["destructiveHint"].is_boolean(), "{name}: says whether it destroys");
        }
        assert!(tool.get("outputSchema").is_some(), "{name}: an output schema");
        assert!(!tool.to_string().contains("\"uint"), "{name}: no schema format a validator does not know");
    }

    let summary = server.call("library_summary", json!({}));
    assert_eq!(summary["structuredContent"]["songs"], 2);

    // Search: a typo, then Cyrillic found by its Latin spelling.
    let found = server.call("search", json!({ "query": "revrie" }));
    let songs = found["structuredContent"]["songs"].as_array().unwrap();
    assert_eq!(songs[0]["title"], "Reverie", "{found}");
    let id = songs[0]["songId"].as_str().unwrap().to_owned();
    let found = server.call("search", json!({ "query": "brodyaga" }));
    assert_eq!(found["structuredContent"]["songs"][0]["title"], "Бродяга", "{found}");

    let detail = server.call("get_song", json!({ "song_id": id }));
    let detail = &detail["structuredContent"];
    assert_eq!(detail["song"]["artists"][0], "Mika Nakashima");
    assert_eq!(detail["file"]["format"], "FLAC");
    assert_eq!(detail["stats"]["plays"], 0);

    let page = server.call("list_songs", json!({ "scope": "artist:Кино" }));
    assert_eq!(page["structuredContent"]["total"], 1);
    let albums = server.call("list_albums", json!({}));
    assert_eq!(albums["structuredContent"]["albums"][0]["title"], "Test Album");
    let playlists = server.call("list_playlists", json!({}));
    assert_eq!(playlists["structuredContent"]["playlists"][0]["playlistId"], "Favorites");
    let stats = server.call("stats_dashboard", json!({ "range": "last_30_days" }));
    assert_eq!(stats["structuredContent"]["plays"], 0, "{stats}");

    // Mistakes come back as tool errors with a way forward, not as a broken connection.
    let missing = server.call("get_song", json!({ "song_id": "nothing" }));
    assert_eq!(missing["isError"], true);
    assert!(missing["content"][0]["text"].as_str().unwrap().contains("search"));
    let wrong = server.call("list_songs", json!({ "scope": "mood:calm" }));
    assert_eq!(wrong["isError"], true);

    let resources = server.request("resources/list", json!({}))["resources"].clone();
    assert!(resources.as_array().unwrap().iter().any(|r| r["uri"] == "nemora://docs/overview"));
    let overview = server.request("resources/read", json!({ "uri": "nemora://docs/overview" }));
    assert!(overview["contents"][0]["text"].as_str().unwrap().contains("Nemora"));
    drop(server);

    assert_eq!(std::fs::read(&db_path).unwrap(), before, "the library's file did not change");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn no_library_is_said_plainly() {
    let root = temp_dir("empty");
    let mut server = Server::start(&root);
    let summary = server.call("library_summary", json!({}));
    assert_eq!(summary["isError"], true);
    assert!(summary["content"][0]["text"].as_str().unwrap().contains("No Nemora library"));
    drop(server);
    assert!(!root.join("nemora.db").exists(), "nothing created");
    let _ = std::fs::remove_dir_all(&root);
}
