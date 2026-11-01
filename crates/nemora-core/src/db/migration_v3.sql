-- state --------------------------------------------------------------------------------------
-- Versions (PLAN/18 D6): a song played with a sound of its own ("Title - Slowed"). Nemora's own
-- data: no file, nothing in the tags; plays, signals and the heart stay the song's. A playlist item
-- points at a version through `playlist_items.variant_hint` = 'version:<version_id>'.
CREATE TABLE song_versions (
  version_id  INTEGER PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES tracks(song_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  semitones   REAL NOT NULL DEFAULT 0,             -- the speed; the pitch goes with it unless keep_pitch
  keep_pitch  INTEGER NOT NULL DEFAULT 0,
  reverb      REAL NOT NULL DEFAULT 0,             -- 0..1
  size        TEXT NOT NULL DEFAULT 'hall' CHECK (size IN ('room', 'hall', 'vast')),
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX song_versions_song ON song_versions(song_id);

-- fact ---------------------------------------------------------------------------------------
-- Which version a play was, so Nemora knows how a song is usually heard; never a statistic of its own.
ALTER TABLE play_details ADD COLUMN version_id INTEGER;
