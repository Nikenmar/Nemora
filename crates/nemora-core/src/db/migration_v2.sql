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
