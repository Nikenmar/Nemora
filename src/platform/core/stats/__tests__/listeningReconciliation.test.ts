import { describe, expect, test } from '@jest/globals';

import {
  absorbLegacySurplus,
  countersFromLegacyRows,
  deriveListeningRows,
  legacyRowsDigest,
  recordListening,
  trackKeyOf
} from '../listeningEvents';

const atMs = new Date(2026, 7, 16, 12).getTime();

const fingerprint = (songId = 'song-a'): SongFingerprint => ({
  songId,
  title: 'Downgrade Track',
  artists: ['Nemora'],
  duration: 180.2,
  fileName: 'downgrade.flac'
});

const song = (songId = 'song-a'): SavableSongData => ({
  songId,
  title: 'Downgrade Track',
  artists: [{ artistId: 'artist-a', name: 'Nemora' }],
  duration: 180.2,
  path: 'E:\\Music\\downgrade.flac',
  isAFavorite: false,
  isArtworkAvailable: false,
  addedDate: 1
});

const row = (
  listens: number,
  fullListens = 0,
  skips = 0,
  identity = fingerprint()
): SongListeningData => ({
  songId: identity.songId,
  listens: [{ year: 2026, listens: [[atMs, listens]] }],
  fullListens,
  skips,
  fingerprint: identity
});

const listensOf = (value: SongListeningData): number =>
  value.listens.reduce(
    (total, yearly) =>
      total + yearly.listens.reduce((yearTotal, [, count]) => yearTotal + count, 0),
    0
  );

describe('legacy listening reconciliation', () => {
  test('absorbs the exact downgrade surplus before the next play and is idempotent', () => {
    const originalLegacy = row(100, 80, 5);
    const migrated = countersFromLegacyRows(
      [originalLegacy],
      `migrated:${legacyRowsDigest([originalLegacy])}`,
      'install-a'
    ).file;
    const afterDowngrade = row(110, 83, 7);

    const reconciled = absorbLegacySurplus(migrated, [afterDowngrade], 'legacy-drift');
    const key = trackKeyOf(fingerprint());

    expect(reconciled).toMatchObject({ rowsAbsorbed: 1, listensAbsorbed: 10 });
    expect(reconciled.file.counters[key]['legacy-drift']['2026-08-16']).toEqual({
      l: 10,
      f: 3,
      s: 2
    });
    expect(migrated.counters[key]['legacy-drift']).toBeUndefined();

    const afterOneNewPlay = recordListening(
      reconciled.file,
      fingerprint(),
      'listen',
      atMs,
      reconciled.file.installId
    );
    const rebuilt = deriveListeningRows(afterOneNewPlay, [song()], [afterDowngrade]);
    expect(listensOf(rebuilt[0])).toBe(111);
    expect(rebuilt[0]).toMatchObject({ fullListens: 83, skips: 7 });

    const secondHydrate = absorbLegacySurplus(afterOneNewPlay, rebuilt, 'legacy-drift');
    expect(secondHydrate).toMatchObject({ rowsAbsorbed: 0, listensAbsorbed: 0 });
    expect(secondHydrate.file).toEqual(afterOneNewPlay);
  });

  test('absorbs an unknown fingerprinted row without lowering existing counters', () => {
    const existing = row(9, 4, 2);
    const file = countersFromLegacyRows([existing], 'migrated:existing', 'install-a').file;
    const unknownIdentity = {
      ...fingerprint('song-b'),
      title: 'Unknown Track',
      fileName: 'unknown.flac'
    };

    const reconciled = absorbLegacySurplus(
      file,
      [row(3, 1, 1), row(4, 2, 1, unknownIdentity)],
      'legacy-drift'
    );

    expect(reconciled).toMatchObject({ rowsAbsorbed: 1, listensAbsorbed: 4 });
    expect(reconciled.file.counters[trackKeyOf(fingerprint())]['migrated:existing']).toEqual(
      file.counters[trackKeyOf(fingerprint())]['migrated:existing']
    );
    expect(
      reconciled.file.counters[trackKeyOf(unknownIdentity)]['legacy-drift']['2026-08-16']
    ).toEqual({ l: 4, f: 2, s: 1 });
  });

  test('legacy source identity ignores row order and object-key order', () => {
    const first = row(2, 1, 0);
    const secondIdentity = {
      ...fingerprint('song-b'),
      title: 'Second Track',
      fileName: 'second.flac'
    };
    const second = row(5, 4, 1, secondIdentity);
    const reorderedFirst: SongListeningData = {
      fingerprint: first.fingerprint,
      skips: first.skips,
      fullListens: first.fullListens,
      listens: first.listens,
      songId: first.songId
    };

    expect(legacyRowsDigest([first, second])).toBe(legacyRowsDigest([second, reorderedFirst]));
  });
});
