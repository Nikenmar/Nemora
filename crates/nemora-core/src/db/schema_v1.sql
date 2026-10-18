-- device ------------------------------------------------------------------------------------
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- keys: device_id, created_at, import:<source digest>

CREATE TABLE folders (
  folder_id   INTEGER PRIMARY KEY,
  uri         TEXT NOT NULL UNIQUE,          -- Windows path or Android tree URI
  parent_id   INTEGER REFERENCES folders(folder_id),
  excluded    INTEGER NOT NULL DEFAULT 0     -- a left-out subfolder of a music folder
) STRICT;

-- identity and library -------------------------------------------------------------------------
CREATE TABLE tracks (                        -- one row per song_id, never deleted
  song_id       TEXT PRIMARY KEY,
  codec         TEXT NOT NULL,
  sample_rate   INTEGER NOT NULL,
  bit_depth     INTEGER,
  channels      INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  bitrate       INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE track_variants (                -- a library row: one song_id with one set of tags
  variant_id    INTEGER PRIMARY KEY,
  song_id       TEXT NOT NULL REFERENCES tracks(song_id),
  tag_signature TEXT NOT NULL,               -- BLAKE3 of the normalised display tags (below)
  title         TEXT NOT NULL,
  title_sort    TEXT NOT NULL,               -- search::fold::normalize(title): one collation for every script
  artist_sort   TEXT NOT NULL,               -- normalised artists, joined with ', '
  album         TEXT,
  album_sort    TEXT,
  year          INTEGER,
  track_no      INTEGER,
  disc_no       INTEGER,
  cover_hash    TEXT REFERENCES covers(cover_hash),
  last_seen_at  INTEGER NOT NULL,
  present       INTEGER NOT NULL DEFAULT 1,  -- cache: at least one location with the file there
  UNIQUE (song_id, tag_signature)
) STRICT;

CREATE TABLE variant_artists (
  variant_id INTEGER NOT NULL REFERENCES track_variants(variant_id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('artist', 'album_artist')),
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  PRIMARY KEY (variant_id, role, position)
) STRICT;

CREATE TABLE variant_genres (
  variant_id INTEGER NOT NULL REFERENCES track_variants(variant_id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  PRIMARY KEY (variant_id, position)
) STRICT;

CREATE TABLE locations (                     -- device; doubles as the scan index
  location_id   INTEGER PRIMARY KEY,
  variant_id    INTEGER NOT NULL REFERENCES track_variants(variant_id),
  uri           TEXT NOT NULL UNIQUE,
  folder_id     INTEGER REFERENCES folders(folder_id),
  size          INTEGER NOT NULL,
  mtime         INTEGER NOT NULL,
  scanned_at    INTEGER NOT NULL,
  missing_since INTEGER                      -- NULL while the file is present
) STRICT;

CREATE TABLE pending_tracks (                -- imported history whose file has not been seen yet
  pending_id   INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,                -- 'nemora-1.x', 'android-base', 'stats-export'
  old_song_id  TEXT,
  file_name    TEXT,
  title        TEXT,
  artists      TEXT,                         -- JSON array
  duration_ms  INTEGER,
  resolved_to  TEXT REFERENCES tracks(song_id)  -- set once, when a matching file appears
) STRICT;

CREATE TABLE covers (
  cover_hash TEXT PRIMARY KEY,               -- BLAKE3 of the original picture bytes, hex
  width      INTEGER,
  height     INTEGER,
  mime       TEXT,
  origin     TEXT NOT NULL CHECK (origin IN ('embedded', 'folder', 'custom', 'net')),
  palette    TEXT,                           -- JSON
  created_at INTEGER NOT NULL
) STRICT;

-- facts ----------------------------------------------------------------------------------------
CREATE TABLE play_events (
  event_id        TEXT PRIMARY KEY,          -- device_id ':' seq
  device_id       TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  song_id         TEXT NOT NULL REFERENCES tracks(song_id),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  utc_offset_min  INTEGER NOT NULL,
  heard_ms        INTEGER NOT NULL,          -- media time played, without pauses and seek jumps
  duration_ms     INTEGER NOT NULL,
  max_position_ms INTEGER NOT NULL,
  end_reason      TEXT NOT NULL CHECK (end_reason IN
                    ('finished', 'user_next', 'user_previous', 'user_selected',
                     'stopped', 'app_closed', 'sleep_timer', 'queue_cleared', 'error')),
  source_kind     TEXT,                      -- 'playlist', 'album', 'artist', 'folder', 'shuffle', ...
  source_id       TEXT,
  seeks           TEXT,                      -- JSON [[position_ms, count], ...] hot spots
  UNIQUE (device_id, seq)
) STRICT;

CREATE TABLE legacy_daily (                  -- 1.x day counters, imported once
  source_id  TEXT NOT NULL,                  -- the 1.x source id (installId, migrated:..., nora:...)
  song_id    TEXT REFERENCES tracks(song_id),
  pending_id INTEGER REFERENCES pending_tracks(pending_id),
  day        TEXT NOT NULL,                  -- 'YYYY-MM-DD' as 1.x recorded it
  l INTEGER NOT NULL DEFAULT 0, f INTEGER NOT NULL DEFAULT 0, s INTEGER NOT NULL DEFAULT 0,
  hours      TEXT,                           -- JSON {hour: listens}, present from 1.1.0
  plays      INTEGER NOT NULL DEFAULT 0,     -- derived, see "Imported days" below
  CHECK ((song_id IS NULL) <> (pending_id IS NULL))
) STRICT;
-- Not a PRIMARY KEY: in a STRICT table key columns are NOT NULL, and one of the two subjects is
-- always NULL.
CREATE UNIQUE INDEX legacy_daily_key
  ON legacy_daily(source_id, day, ifnull(song_id, ''), ifnull(pending_id, 0));

CREATE TABLE duels (
  duel_id     TEXT PRIMARY KEY,              -- device_id ':' seq, or 'import:' n
  device_id   TEXT NOT NULL,
  at          INTEGER NOT NULL,
  song_a      TEXT NOT NULL REFERENCES tracks(song_id),
  song_b      TEXT NOT NULL REFERENCES tracks(song_id),
  outcome     TEXT NOT NULL CHECK (outcome IN ('a', 'b', 'draw', 'skip')),
  skip_reason TEXT,
  imported    INTEGER NOT NULL DEFAULT 0,    -- 1.x history: shown, never replayed
  delta_a     REAL,
  delta_b     REAL
) STRICT;

CREATE TABLE elo_baseline (                  -- ratings as of the 1.x import
  song_id TEXT PRIMARY KEY REFERENCES tracks(song_id),
  rating REAL NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
  losses INTEGER NOT NULL, draws INTEGER NOT NULL, imported_at INTEGER NOT NULL
) STRICT;

-- documents ------------------------------------------------------------------------------------
CREATE TABLE favorites (
  song_id TEXT PRIMARY KEY REFERENCES tracks(song_id),
  value INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE blacklist_songs (
  song_id TEXT PRIMARY KEY REFERENCES tracks(song_id),
  value INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE playlists (
  playlist_id     TEXT PRIMARY KEY,          -- UUID
  name            TEXT NOT NULL,
  cover_hash      TEXT REFERENCES covers(cover_hash),
  pinned_position INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT NOT NULL,
  deleted_at      INTEGER
) STRICT;

CREATE TABLE playlist_items (
  playlist_id  TEXT NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  song_id      TEXT REFERENCES tracks(song_id),
  pending_id   INTEGER REFERENCES pending_tracks(pending_id),
  variant_hint TEXT,                         -- tag_signature of the variant that was added
  CHECK ((song_id IS NULL) <> (pending_id IS NULL)),
  PRIMARY KEY (playlist_id, position)
) STRICT;

CREATE TABLE tierlists (
  tierlist_id TEXT PRIMARY KEY, doc TEXT NOT NULL,   -- JSON document
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE TABLE lyrics (
  song_id     TEXT PRIMARY KEY REFERENCES tracks(song_id),
  text        TEXT NOT NULL,                 -- LRC (timed lines, word timing, [lang:] translations) or plain text
  synced      INTEGER NOT NULL DEFAULT 0,    -- derived from text: at least one timed line
  source      TEXT NOT NULL CHECK (source IN ('tags', 'lrc_file', 'lrclib', 'musixmatch', 'user')),
  language    TEXT,
  user_edited INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL
) STRICT;

CREATE TABLE settings_shared (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
) STRICT;

-- device state ---------------------------------------------------------------------------------
CREATE TABLE settings_device (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

CREATE TABLE queue_items (                   -- the persisted queue for resume and the car's Continue
  position     INTEGER PRIMARY KEY,
  song_id      TEXT NOT NULL REFERENCES tracks(song_id),
  variant_hint TEXT,
  source_kind  TEXT,
  source_id    TEXT
) STRICT;
-- current index, position and revision live in settings_device under 'queue.*'

-- caches ---------------------------------------------------------------------------------------
CREATE TABLE play_daily (
  song_id TEXT NOT NULL, day TEXT NOT NULL,
  starts INTEGER NOT NULL, plays INTEGER NOT NULL, full INTEGER NOT NULL,
  skips INTEGER NOT NULL, heard_ms INTEGER NOT NULL,
  PRIMARY KEY (song_id, day)
) STRICT, WITHOUT ROWID;

CREATE TABLE play_hourly (
  song_id TEXT NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL, plays INTEGER NOT NULL,
  PRIMARY KEY (song_id, day, hour)
) STRICT, WITHOUT ROWID;

CREATE TABLE song_totals (                 -- per song, imported days and own events together
  song_id TEXT PRIMARY KEY, starts INTEGER NOT NULL, plays INTEGER NOT NULL, full INTEGER NOT NULL,
  skips INTEGER NOT NULL, heard_ms INTEGER NOT NULL, last_day TEXT
) STRICT;

CREATE TABLE elo_ratings (
  song_id TEXT PRIMARY KEY, rating REAL NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
  losses INTEGER NOT NULL, draws INTEGER NOT NULL, last_duel_at INTEGER
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
  title, artists, album, content = '', contentless_delete = 1, tokenize = 'trigram'
  -- rowid = variant_id; contentless_delete lets a changed variant drop its old row
);

CREATE INDEX play_events_song ON play_events(song_id, started_at);
CREATE INDEX variants_song ON track_variants(song_id);
CREATE INDEX variants_title_sort ON track_variants(title_sort);
CREATE INDEX variants_artist_sort ON track_variants(artist_sort);
CREATE INDEX variants_album_sort ON track_variants(album_sort);
CREATE INDEX locations_variant ON locations(variant_id);
CREATE INDEX playlist_items_song ON playlist_items(song_id);
CREATE INDEX duels_at ON duels(at);
