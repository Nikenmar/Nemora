# Database schema v4: migration 4

Status: **adopted** (2026-11-02). Rationale: the vault plan
`PROJECTS/nemora-reborn/PLAN/19-home-for-you-and-lyrics.md` (D6, search by a line).

## Rules

- **Additive only**: two tables, one index, one full-text table. Every v1-v3 query keeps its
  meaning. `PRAGMA user_version` goes from 3 to 4.
- **One way.** A build that knows only v3 refuses a v4 file (`SchemaTooNew`); before migrating a file
  on disk it is copied with `VACUUM INTO` to `<profile>/backups/nemora-v3-<YYYY-MM-DD>.db`.
- **In one transaction**, after the backup.
- **A cache.** Nothing here is the user's data: the lines are made from `lyrics` by
  `lyrics_index::sync`, which compares `lyrics_indexed.updated_at` with `lyrics.updated_at` and
  rebuilds what differs. The migration leaves the tables empty; the first search fills them.
- The Android app must ship the same migration before it opens a v4 profile.

## Tables

```sql
-- cache --------------------------------------------------------------------------------------
-- Search by a line (PLAN/19 D6): every stored lyrics line, made from `lyrics` and rebuilt at will.
-- `lyrics_indexed` says which `lyrics.updated_at` a song's lines were made from.
CREATE TABLE lyrics_lines (
  line_id  INTEGER PRIMARY KEY,
  song_id  TEXT NOT NULL REFERENCES tracks(song_id) ON DELETE CASCADE,
  line_no  INTEGER NOT NULL,
  start_ms INTEGER,                                 -- NULL for plain lyrics
  text     TEXT NOT NULL
) STRICT;
CREATE INDEX lyrics_lines_song ON lyrics_lines(song_id, line_no);
CREATE TABLE lyrics_indexed (
  song_id    TEXT PRIMARY KEY REFERENCES tracks(song_id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE VIRTUAL TABLE lyrics_fts USING fts5(
  keys, content = '', contentless_delete = 1, tokenize = 'trigram'
  -- rowid = lyrics_lines.line_id; keys = the line's search keys (search::fold::text_keys), one per line
);
```
