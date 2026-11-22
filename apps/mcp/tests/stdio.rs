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
        Self::start_as(profile, json!({ "name": "test", "version": "1" }))
    }

    fn start_as(profile: &Path, client_info: Value) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_nemora-mcp"))
            .arg("--profile")
            .arg(profile)
            // Never the user's own Nemora, should it be running.
            .env("NEMORA_AGENT_PIPE", format!("nemora-mcp-test-{}", std::process::id()))
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
            json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": client_info }),
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
    // Lyrics only in a file beside the song, as most libraries have them: none are stored.
    std::fs::write(music.join("a.lrc"), "[00:01.00]from the file\n[00:02.50]second line\n").unwrap();
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
    let other = found["structuredContent"]["songs"][0]["songId"].as_str().unwrap().to_owned();

    let detail = server.call("get_song", json!({ "song_id": id }));
    let detail = &detail["structuredContent"];
    assert_eq!(detail["song"]["artists"][0], "Mika Nakashima");
    assert_eq!(detail["file"]["format"], "FLAC");
    assert_eq!(detail["stats"]["plays"], 0);
    assert_eq!(detail["hasLyrics"], true, "the .lrc beside the file counts");

    // Lyrics the library never stored are read from the song's file (and still not written).
    let lyrics = server.call("get_lyrics", json!({ "song_id": id }));
    let lyrics = &lyrics["structuredContent"];
    assert_eq!(lyrics["source"], "lrc_file", "{lyrics}");
    assert_eq!(lyrics["synced"], true);
    assert!(lyrics["text"].as_str().unwrap().contains("from the file"));
    let none = server.call("get_lyrics", json!({ "song_id": other }));
    assert_eq!(none["isError"], true);
    assert!(none["content"][0]["text"].as_str().unwrap().contains("No lyrics"));

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
fn reever_reads_with_a_level_of_its_own() {
    let root = temp_dir("reever");
    let set = |key: &str, level: &str| {
        let db = nemora_core::db::Db::open(&root.join("nemora.db")).unwrap();
        nemora_core::settings::set_device(&db, key, &json!(level)).unwrap();
    };
    let reever = || json!({ "name": "reever", "title": "Reever", "version": "1" });
    let error = |reply: &Value| {
        assert_eq!(reply["isError"], true, "{reply}");
        reply["content"][0]["text"].as_str().unwrap().to_owned()
    };

    // Agents turned off: another agent reads nothing, Reever reads with its default, control.
    set("agent.access", "off");
    let mut agent = Server::start(&root);
    assert!(error(&agent.call("library_summary", json!({}))).contains("turned agents off"));
    let status = agent.call("app_status", json!({}));
    assert_eq!(status["structuredContent"]["running"], false, "{status}");
    assert_eq!(status["structuredContent"]["access"], "off", "{status}");
    drop(agent);
    let mut voice = Server::start_as(&root, reever());
    let summary = voice.call("library_summary", json!({}));
    assert_eq!(summary["structuredContent"]["songs"], 0, "{summary}");
    assert_eq!(voice.call("app_status", json!({}))["structuredContent"]["access"], "control");
    drop(voice);

    // Reever turned off, agents allowed: the other way round.
    set("agent.access", "control");
    set("agent.access.reever", "off");
    let mut voice = Server::start_as(&root, reever());
    assert!(error(&voice.call("search", json!({ "query": "rain" }))).contains("turned Reever off"));
    assert_eq!(voice.call("app_status", json!({}))["structuredContent"]["access"], "off");
    drop(voice);
    let mut agent = Server::start(&root);
    assert_eq!(agent.call("library_summary", json!({}))["structuredContent"]["songs"], 0);
    drop(agent);
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
