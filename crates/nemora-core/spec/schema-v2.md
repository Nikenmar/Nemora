# Database schema v2: migration 2

Status: **adopted** (2026-11-01), the first forward migration of `schema-v1.md`. Rationale: the
vault plan `PROJECTS/nemora-reborn/PLAN/15-smart-shuffle-depth.md` (D1, D2 and the performance
section).

## Rules

- **Additive only.** New tables and new indexes; no v1 table, column, index or constraint changes,
  so every v1 query keeps its meaning (an added index only makes some faster). `PRAGMA user_version` goes from 1 to 2.
- **One way.** A build that knows only v1 refuses a v2 file (`SchemaTooNew`). Before migrating a file
  on disk, `nemora-core` copies it with `VACUUM INTO` to `<profile>/backups/nemora-v1-<YYYY-MM-DD>.db`
  (a number is appended when that name exists); that copy is the way back.
- **In one transaction**, after the backup; a failure leaves the file at v1.
- A new database runs `schema-v1.md`'s SQL and then this migration, so every file walks the same path.

## Tables

```sql
-- fact ---------------------------------------------------------------------------------------
-- What the player knows about a play beyond play_events: why it started and every seek. One row
-- per event, written with it; events from before v2 (and from players that do not send it) have
-- none, which every reader treats as "unknown".
CREATE TABLE play_details (
  event_id     TEXT PRIMARY KEY REFERENCES play_events(event_id),
  start_reason TEXT NOT NULL CHECK (start_reason IN
                 ('auto', 'user_selected', 'user_previous', 'restart', 'resume', 'unknown')),
  seeks        TEXT                          -- JSON [[at_ms, from_ms, to_ms], ...], at most 64
) STRICT;

-- One Song Guessr round about one song of the library.
CREATE TABLE guessr_rounds (
  round_id  TEXT PRIMARY KEY,                -- random 26-character id
  device_id TEXT NOT NULL,
  song_id   TEXT NOT NULL REFERENCES tracks(song_id),
  at        INTEGER NOT NULL,
  attempts  INTEGER CHECK (attempts BETWEEN 1 AND 6),   -- the attempt that got it, NULL if missed
  gave_up   INTEGER NOT NULL DEFAULT 0,
  pool_kind TEXT
) STRICT;

-- cache --------------------------------------------------------------------------------------
-- Per-song evidence for Smart Shuffle, kept current by the writes that change it and rebuilt from
-- the facts when `meta.song_signals_version` differs from the code's.
CREATE TABLE song_signals (
  song_id     TEXT PRIMARY KEY REFERENCES tracks(song_id),
  positive    REAL NOT NULL DEFAULT 0,       -- decayed sum of liking evidence
  negative    REAL NOT NULL DEFAULT 0,       -- decayed sum of disliking evidence
  decayed_to  INTEGER NOT NULL DEFAULT 0,    -- the time both sums refer to (ms)
  own_picks   INTEGER NOT NULL DEFAULT 0,
  replays     INTEGER NOT NULL DEFAULT 0,
  rewinds     INTEGER NOT NULL DEFAULT 0,
  scrub_skips INTEGER NOT NULL DEFAULT 0,
  last_heard  INTEGER,
  guessed     INTEGER NOT NULL DEFAULT 0,
  missed      INTEGER NOT NULL DEFAULT 0,
  last_guessed INTEGER
) STRICT;

-- A track's sound in three numbers, from nemora-audio's visual envelope.
CREATE TABLE track_features (
  song_id     TEXT PRIMARY KEY REFERENCES tracks(song_id),
  version     INTEGER NOT NULL,
  energy      REAL NOT NULL,
  brightness  REAL NOT NULL,
  dynamics    REAL NOT NULL,
  analysed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX guessr_rounds_song ON guessr_rounds(song_id, at);
-- Recent plays and recent skips are read by time (Smart Shuffle's freshness and skip-aware).
CREATE INDEX play_events_ended ON play_events(ended_at);
```

## Meanings

- `play_details.start_reason`: `auto` the player advanced to it (end of the previous song, or a queue
  built by a play button); `user_selected` the user picked it (a row, a search result, the queue);
  `user_previous` the previous button brought it back; `restart` previous pressed during the song,
  which starts it again; `resume` the session restored at start-up; `unknown` anything else.
- `play_details.seeks`: every seek of the session in order, `[at_ms, from_ms, to_ms]`, the first 64.
  `play_events.seeks` keeps its v1 meaning (hot spots).
- `guessr_rounds.attempts`: 1..6, the attempt that found the song; NULL with `gave_up = 0` means the
  round ran out of attempts, `gave_up = 1` that the user gave up.
- `song_signals` and `track_features` are **cache** tables: dropped and rebuilt at will. Their
  formulas are versioned (`meta.song_signals_version`, `track_features.version`), not the schema.
