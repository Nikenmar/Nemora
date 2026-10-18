/*
 * Oracle: runs 1.1.9's own search code on fixtures/synthetic/oracle/search-corpus.json and prints
 * what it answers. The Rust port is tested against this output (tests/search_oracle.rs).
 * Regenerate with tools/oracle/run.ps1; `@old` is aliased to the 1.1.9 checkout's `src`.
 */
import { readFileSync } from 'node:fs';

import { buildQueryVariants, buildTextKeys } from '@old/common/searchFolding';
import { scoreSearchValue } from '@old/common/searchScoring';
import { hasRomanizableScript, romanizeForSearch } from '@old/platform/core/search/romanizeForSearch';
import search from '@old/platform/core/search/search';

type Named = { id: string; name: string };
type Song = { id: string; title: string; artists: string[]; album: string | null; popularity: number };
type Corpus = { songs: Song[]; artists: Named[]; albums: Named[]; playlists: Named[]; genres: Named[]; queries: string[] };

const corpus: Corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const finite = (n: number) => (Number.isFinite(n) ? n : null);

const repository = {
  getSongs: () =>
    corpus.songs.map((s) => ({
      songId: s.id,
      title: s.title,
      artists: s.artists.map((name, i) => ({ name, artistId: `${s.id}-${i}` })),
      album: s.album ? { name: s.album, albumId: `${s.id}-album` } : undefined,
      isArtworkAvailable: false
    })),
  getArtists: () => corpus.artists.map((a) => ({ artistId: a.id, name: a.name })),
  getAlbums: () => corpus.albums.map((a) => ({ albumId: a.id, title: a.name })),
  getGenres: () => corpus.genres.map((g) => ({ genreId: g.id, name: g.name })),
  getPlaylists: () => corpus.playlists.map((p) => ({ playlistId: p.id, name: p.name })),
  // 1.x popularity = the number of listen entries plus full listens.
  getListeningData: () =>
    corpus.songs.map((s) => ({
      songId: s.id,
      listens: [{ year: 2026, listens: Array.from({ length: s.popularity }, () => [0, 1]) }],
      fullListens: 0
    })),
  getSongBlacklist: () => [],
  getSongArtworkPaths: () => ({}),
  getArtistArtworkPaths: () => ({}),
  getAlbumArtworkPaths: () => ({}),
  getPlaylistArtworkPaths: () => ({}),
  getRecentSearches: () => [],
  setRecentSearches: () => undefined
};

const texts = new Set<string>();
for (const s of corpus.songs) {
  texts.add(s.title);
  s.artists.forEach((a) => texts.add(a));
  if (s.album) texts.add(s.album);
  texts.add([s.title, ...s.artists].join(' '));
}
for (const list of [corpus.artists, corpus.albums, corpus.playlists, corpus.genres]) list.forEach((n) => texts.add(n.name));

const keys = [...texts].map((text) => ({
  text,
  romanized: hasRomanizableScript(text) ? (romanizeForSearch(text) ?? null) : null,
  keys: buildTextKeys(text, hasRomanizableScript(text) ? romanizeForSearch(text) : undefined)
}));

const queries = corpus.queries.map((query) => ({ query, variants: buildQueryVariants(query) }));

const scores: { query: string; value: string; score: number | null }[] = [];
for (const q of queries)
  for (const v of q.variants)
    for (const k of keys.slice(0, 40))
      for (const kv of k.keys) scores.push({ query: v.text, value: kv.text, score: finite(scoreSearchValue(v.text, kv.text)) });

const searches = corpus.queries.map((query) => {
  const r = search(repository as never, 'All', query, false) as never as {
    songs: { songId: string }[];
    artists: { artistId: string }[];
    albums: { albumId: string }[];
    playlists: { playlistId: string }[];
    genres: { genreId: string }[];
    availableResults: string[];
  };
  return {
    query,
    songs: r.songs.map((s) => s.songId),
    artists: r.artists.map((a) => a.artistId),
    albums: r.albums.map((a) => a.albumId),
    playlists: r.playlists.map((p) => p.playlistId),
    genres: r.genres.map((g) => g.genreId),
    suggestions: r.availableResults
  };
});

process.stdout.write(JSON.stringify({ generatedFrom: '1.1.9 (326f15b)', keys, queries, scores, searches }, null, 1));
