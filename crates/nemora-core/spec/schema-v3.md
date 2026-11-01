# Database schema v3: migration 3

Status: **adopted** (2026-11-01). Rationale: the vault plan
`PROJECTS/nemora-reborn/PLAN/18-slowed-reverb-autoeq.md` (D6, versions).

## Rules

- **Additive only**, as v2: one new table, one index, one nullable column on a v2 table. Every v1
  and v2 query keeps its meaning. `PRAGMA user_version` goes from 2 to 3.
- **One way.** A build that knows only v2 refuses a v3 file (`SchemaTooNew`); before migrating a file
  on disk it is copied with `VACUUM INTO` to `<profile>/backups/nemora-v2-<YYYY-MM-DD>.db`.
- **In one transaction**, after the backup.
- Playlist items point at a version through the existing `variant_hint` column, written as
  `version:<version_id>` (a tag signature never starts with `version:`), so the playlist model -
  items rewritten as a whole - does not change.

## Tables

```sql
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
```
