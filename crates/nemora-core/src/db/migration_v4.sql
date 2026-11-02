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
