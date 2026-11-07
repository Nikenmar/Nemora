# nemora-mcp

Nemora for AI agents, over the Model Context Protocol. A small program that ships beside
`nemora.exe` and talks MCP over stdio: the agent starts it, nothing listens on the network.

It gives an agent 54 tools ([TOOLS.md](TOOLS.md)): read the library, statistics, taste and lyrics;
play, run the queue and open pages; keep playlists, favourites, lyrics and versions; at the
user's choice, edit tags and move files to the recycle bin. The instructions it sends at connect
and its docs (`nemora://docs/overview`, `nemora://docs/recipes`) teach the agent how to use them,
so no extra skill or prompt is needed.

## Adding it to an agent

Nemora, Settings, AI agents: copy the command or press **Set up** next to the agent. By hand, the
command is the installed file, with no arguments:

```
"C:\Users\<you>\AppData\Local\Nemora\nemora-mcp.exe"
```

| Agent | Where |
|---|---|
| Claude Code | `claude mcp add --scope user nemora -- "<path>"` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json`, `mcpServers.nemora = { "command": "<path>", "args": [] }` |
| Codex | `~/.codex/config.toml`, `[mcp_servers.nemora]` with `command = '<path>'` |
| Cursor | `~/.cursor/mcp.json`, `mcpServers.nemora` |
| VS Code | `%APPDATA%\Code\User\mcp.json`, `servers.nemora = { "type": "stdio", "command": "<path>" }` |
| Gemini CLI | `~/.gemini/settings.json`, `mcpServers.nemora` |

Setting up from Nemora adds that one entry and keeps a copy of the file beside it
(`<file>.nemora-backup-<time>`); a file that is not plain JSON (comments) is left alone.

## What an agent may do

The user chooses in Settings, AI agents; the agent cannot raise it.

- **off**: nothing, not even reading the library.
- **read**: reading, and seeing what plays and the queue.
- **control** (default): also playing, the queue, pages, playlists, favourites, lyrics, versions.
  The music files are never changed.
- **full**: also tag edits (a dry run first) and moving files to the recycle bin, each after
  the user agreed.

Every change shows a notice in Nemora with the agent's name and goes into the agents' log
(Settings, AI agents; the latest 200). Playlist and favourite changes can be undone by the agent
(`undo_last_change`, the latest 50).

## How it works

- **Reading** opens the profile's `nemora.db` read-only (`Db::open_read_only`: no migration, no
  write; the schema version must match the app's). It works with Nemora closed.
- **Everything else** goes to the running app over a local named pipe,
  `\\.\pipe\nemora-agent-<USERNAME>` (one JSON line each way, local clients only). The app checks
  each request against the access level, logs changes, and has the view play and show pages as a
  click would. A tool that needs the app starts `nemora.exe` from beside itself and waits for it.
- Library text (titles, tags, lyrics, playlist names) is handed to the agent as data, and the
  instructions say so.

## Arguments

- `--profile <dir>`: another profile folder (default `NEMORA_PROFILE_DIR`, as the app reads it,
  else `%APPDATA%\Nemora`).
- `--version`, `--help`.
- `NEMORA_AGENT_PIPE` (environment): another pipe name, for test stands.
- `NEMORA_APP_EXE` (environment): the app to start when it is not beside this file.

## Building and testing

```
cargo build --release -p nemora-mcp
cargo test -p nemora-mcp           # drives the exe over stdio against a library made of tones
python tools/mcp/tools-md.py       # rewrites TOOLS.md from tools/list
```

The installer build stages it (`npm run stage:mcp` in `apps/desktop`, run by
`src-tauri/tauri.mcp.json`): `npm run tauri -- build --config src-tauri/tauri.mcp.json`.
