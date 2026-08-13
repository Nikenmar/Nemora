"""Builds the base profile both players are benchmarked from, and restores it.

The first harness synthesised a profile pointing at copies of 300 tracks in a
scratch directory. Nemora played them; the Electron build did not, and sat on
an error dialog instead, which is how a comparison ended up published against a
player that was producing no sound at all. Rather than keep guessing why it
refuses files there, this uses the profile and the library that the Electron
build demonstrably works with: a copy of the real one, and tracks from their
real location.

The copy is READ-ONLY at the source. Nothing here writes to %APPDATA%\\Nora.

Usage:
  bench-profiles.py base      build the base copy once (slow, copies artwork)
  bench-profiles.py restore   reset both players' stores from the base (fast)
"""

import io
import json
import os
import shutil
import sys

REAL = os.path.join(os.environ['APPDATA'], 'Nora')
BENCH = os.environ.get('NEMORA_BENCH_DIR', r'E:\tmp\nemora-bench2')
BASE = os.path.join(BENCH, 'base')
PROFILES = {
    # Electron resolves userData under APPDATA, so its profile has to sit in a
    # directory named after the product; Tauri takes the path directly.
    'electron': os.path.join(BENCH, 'electron', 'Nora'),
    'tauri': os.path.join(BENCH, 'tauri', 'Nemora'),
}
STORES = (
    'songs.json',
    'artists.json',
    'albums.json',
    'genres.json',
    'playlists.json',
    'userData.json',
    'listening_data.json',
    'blacklist.json',
    'palettes.json',
    'tierlists.json',
    'cmr_stats.json',
)
# A benchmark must not scrobble, announce itself, or phone home.
QUIET = (
    'sendSongScrobblingDataToLastFM',
    'sendSongFavoritesDataToLastFM',
    'sendNowPlayingSongDataToLastFM',
    'enableDiscordRPC',
    'isMusixmatchLyricsEnabled',
    'autoLaunchApp',
)


# The base profile lists NO music folders, and that is a fairness rule.
#
# Nora re-checks its music folders on startup and adds anything it finds, so a
# profile narrowed to 300 songs grew back to the full 1745 within a minute of
# launching - measured, after the isolation below started working. Nemora only
# installs watchers, so it stayed at 300. The comparison would then have been
# one player carrying six times the library of the other. With no folders
# listed, both hold exactly the seeded 300; playback still works because the
# harness hands the player a track path on the command line.
SAMPLE = 300
SEED = 20260812


def read(name):
    path = os.path.join(REAL, name)
    return json.load(io.open(path, encoding='utf-8')) if os.path.exists(path) else None


def write(name, payload):
    io.open(os.path.join(BASE, name), 'w', encoding='utf-8').write(
        json.dumps(payload, ensure_ascii=False)
    )


def build_base():
    """A 300-track library, sampled from the real one, paths left ALONE.

    The sample size is the point of the benchmark; the paths are the point of
    it working. An earlier version copied the 300 files into a scratch folder
    and rewrote the paths to match, which is tidier but the Electron build
    refuses to play from there, silently. Files stay where they are; only the
    library is narrowed.
    """
    import random

    os.makedirs(BASE, exist_ok=True)

    songs_file = read('songs.json')
    alive = [s for s in songs_file['songs'] if os.path.exists(s['path'])]

    by_ext = {}
    for song in alive:
        by_ext.setdefault(os.path.splitext(song['path'])[1].lower(), []).append(song)

    # Keep the real format mix: FLAC and MP3 cost different amounts to decode,
    # so a sample drifting towards one would measure the sample.
    shares = {ext: len(items) / len(alive) * SAMPLE for ext, items in by_ext.items()}
    counts = {ext: int(share) for ext, share in shares.items()}
    for ext in sorted(shares, key=lambda e: shares[e] - counts[e], reverse=True):
        if sum(counts.values()) >= SAMPLE:
            break
        counts[ext] += 1

    rng = random.Random(SEED)
    kept = []
    for ext, count in counts.items():
        if count > 0:
            pool = sorted(by_ext[ext], key=lambda s: s['path'])
            kept.extend(rng.sample(pool, min(count, len(pool))))

    kept_ids = {song['songId'] for song in kept}
    write('songs.json', dict(songs_file, songs=kept))

    for name, key in (('artists.json', 'artists'), ('albums.json', 'albums'), ('genres.json', 'genres')):
        data = read(name)
        if not data:
            continue
        trimmed = []
        for entry in data[key]:
            members = [s for s in entry.get('songs', []) if s.get('songId') in kept_ids]
            if members:
                trimmed.append(dict(entry, songs=members))
        write(name, dict(data, **{key: trimmed}))

    listening = read('listening_data.json')
    if listening:
        write(
            'listening_data.json',
            dict(listening, listeningData=[r for r in listening['listeningData'] if r['songId'] in kept_ids]),
        )

    playlists = read('playlists.json')
    if playlists:
        write(
            'playlists.json',
            dict(
                playlists,
                playlists=[
                    dict(p, songs=[s for s in p.get('songs', []) if s in kept_ids])
                    for p in playlists['playlists']
                    if p['playlistId'] in ('History', 'Favorites', 'Rediscover')
                ],
            ),
        )

    palettes = read('palettes.json')
    if palettes:
        wanted = {s.get('paletteId') for s in kept if s.get('paletteId')}
        write('palettes.json', dict(palettes, palettes=[p for p in palettes['palettes'] if p['paletteId'] in wanted]))

    for name in ('blacklist.json', 'tierlists.json', 'cmr_stats.json'):
        data = read(name)
        if data:
            write(name, data)

    user = read('userData.json')
    preferences = user['userData'].setdefault('preferences', {})
    for switch in QUIET:
        preferences[switch] = False
    user['userData']['recentSearches'] = []
    # No music folders. See the note by SAMPLE: Nora re-scans them on startup
    # and would grow this 300-song profile back to the whole library, leaving
    # the two players carrying different libraries. It also means a benchmark
    # never walks the user's real music folder.
    user['userData']['musicFolders'] = []
    write('userData.json', user)

    covers_source = os.path.join(REAL, 'song_covers')
    covers_target = os.path.join(BASE, 'song_covers')
    os.makedirs(covers_target, exist_ok=True)
    copied = 0
    for song_id in kept_ids:
        for suffix in ('.webp', '-optimized.webp', '-md.webp', '-tl.webp'):
            source = os.path.join(covers_source, song_id + suffix)
            if os.path.exists(source):
                shutil.copy2(source, os.path.join(covers_target, song_id + suffix))
                copied += 1

    io.open(os.path.join(os.path.dirname(BASE), 'tracks.json'), 'w', encoding='utf-8').write(
        json.dumps([s['path'] for s in kept], ensure_ascii=False)
    )
    print(
        json.dumps(
            {
                'base': BASE,
                'songs': len(kept),
                'byExtension': {e: c for e, c in sorted(counts.items()) if c},
                'artworkFiles': copied,
                'seed': SEED,
            },
            indent=2,
        )
    )


def restore():
    """Resets the stores, keeping artwork.

    Artwork is content, not state: it is identical for both players and copying
    283 MB before every launch would make the benchmark measure the copy. The
    stores are what a run mutates, so those are the ones restored.
    """
    for target in PROFILES.values():
        os.makedirs(target, exist_ok=True)
        for name in STORES:
            source = os.path.join(BASE, name)
            if os.path.exists(source):
                shutil.copy2(source, os.path.join(target, name))
        covers = os.path.join(target, 'song_covers')
        if not os.path.isdir(covers):
            shutil.copytree(os.path.join(BASE, 'song_covers'), covers)
        # Renderer state from a previous run would make the app resume a track
        # and skew the next launch.
        for leftover in ('Local Storage', 'Session Storage', 'logs'):
            path = os.path.join(target, leftover)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else 'base'
    if command == 'base':
        build_base()
    elif command == 'restore':
        restore()
    else:
        raise SystemExit(f'unknown command: {command}')
