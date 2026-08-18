import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every host the app fetches from has to be in the Tauri HTTP scope, and the
 * failure when one is not is silent in the way that costs an evening.
 *
 * The renderer routes every remote request through `tauri-plugin-http`, so a
 * host outside the scope is rejected by the ACL before it leaves the process.
 * The callers treat a failed image fetch as "no cover offered" and carry on, so
 * the user sees "Metadata update failed" or simply fewer covers, and the log
 * says nothing about a permission.
 *
 * The reason a test is worth having is that these URLs are NOT in the source.
 * The API host is a literal a reader can check; the CDN that serves the cover
 * arrives at runtime inside the API's own answer, and only shows up when
 * someone edits a tag. Two of them - Deezer's and iTunes' - were already broken
 * this way before anyone noticed, and Deezer's had MOVED, from
 * `e-cdns-images.dzcdn.net` to `cdn-images.dzcdn.net`, with the old host still
 * dutifully listed in the capability file.
 *
 * Sample URLs below are real answers from those APIs, kept verbatim.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');

const scope = (): string[] => {
  const capability = JSON.parse(
    readFileSync(join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8')
  ) as { permissions: (string | { identifier: string; allow?: { url: string }[] })[] };

  const http = capability.permissions.find(
    (permission): permission is { identifier: string; allow: { url: string }[] } =>
      typeof permission === 'object' && permission.identifier === 'http:default'
  );
  return (http?.allow ?? []).map((entry) => entry.url);
};

/** What each provider actually answers with, host and shape preserved. */
const REMOTE_URLS: Record<string, string> = {
  'iTunes metadata': 'https://itunes.apple.com/search?term=x&entity=song',
  'iTunes cover':
    'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/19/59/ef/artwork.jpg/1000x1000bb.jpg',
  'Deezer metadata': 'https://api.deezer.com/search?q=x',
  'Deezer cover':
    'https://cdn-images.dzcdn.net/images/cover/423a64736425179634fd8c971bbd2606/250x250-000000-80-0-0.jpg',
  'Deezer cover, older host':
    'https://e-cdns-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg',
  'Musixmatch lyrics': 'https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?q=x',
  'Musixmatch cover': 'https://s.mxmcdn.net/images-storage/albums5/1/2/3/cover.jpg',
  'Genius metadata': 'https://api.genius.com/search?q=x',
  'Genius image': 'https://images.genius.com/abc123.1000x1000x1.png',
  'Last.fm scrobbling': 'https://ws.audioscrobbler.com/2.0/?method=track.scrobble',
  'Last.fm image': 'https://lastfm.freetls.fastly.net/i/u/300x300/abc.png',
  'LRCLIB lyrics': 'https://lrclib.net/api/get?track_name=x',
  'Spotify covers through the art-getter':
    'https://art-getter-reborncmr.vercel.app/api/apee?inputType=tracks&id=x',
  'Spotify cover': 'https://i.scdn.co/image/ab67616d0000b273baf89eb11ec7c657805d2da0'
};

// The runtime matches these with the URLPattern standard, not with globs, so the
// test has to use the same matcher or it would be checking a different rule.
const hasUrlPattern = typeof (globalThis as { URLPattern?: unknown }).URLPattern === 'function';
const describeWithUrlPattern = hasUrlPattern ? describe : describe.skip;

describeWithUrlPattern('the Tauri HTTP scope', () => {
  const patterns = scope();

  test.each(Object.entries(REMOTE_URLS))('allows %s', (_name, url) => {
    const allowed = patterns.some((pattern) => {
      try {
        return new (globalThis as unknown as { URLPattern: new (p: string) => { test(u: string): boolean } }).URLPattern(
          pattern
        ).test(url);
      } catch {
        return false;
      }
    });
    expect(allowed).toBe(true);
  });

  test('every pattern in the capability file is a valid URLPattern', () => {
    for (const pattern of patterns) {
      expect(() => {
        new (globalThis as unknown as { URLPattern: new (p: string) => unknown }).URLPattern(pattern);
      }).not.toThrow();
    }
  });
});
