import { describe, expect, test } from '@jest/globals';

import type { BlacklistRepository } from '../../filters/repository';
import sortSongs from '../sortSongs';

const song = (
  partial: Partial<SavableSongData> & Pick<SavableSongData, 'songId' | 'title'>
): SavableSongData => ({
  duration: 200,
  isAFavorite: false,
  isArtworkAvailable: false,
  path: `C:/music/${partial.songId}.mp3`,
  addedDate: 0,
  ...partial
});

const blacklistRepository: BlacklistRepository = {
  isSongBlacklisted: (songId) => songId === 's-black',
  getFolderBlacklist: () => []
};

const idsOf = (songs: SavableSongData[]) => songs.map(({ songId }) => songId);

describe('sortSongs: title sorts', () => {
  test('aToZ ignores case and non-word characters', () => {
    const data = [
      song({ songId: 's-2', title: 'zeta!' }),
      song({ songId: 's-1', title: 'Alpha-Raid' }),
      song({ songId: 's-3', title: 'alpha raid' })
    ];
    const sorted = sortSongs(blacklistRepository, data, 'aToZ');
    expect(idsOf(sorted)).toEqual(['s-1', 's-3', 's-2']);
  });

  test('zToA reverses the aToZ order', () => {
    const data = [
      song({ songId: 's-2', title: 'zeta' }),
      song({ songId: 's-1', title: 'alpha' })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'zToA'))).toEqual(['s-2', 's-1']);
  });

  test('returns the data untouched without a sort type', () => {
    const data = [song({ songId: 's-1', title: 'zeta' })];
    expect(sortSongs(blacklistRepository, data)).toBe(data);
  });
});

describe('sortSongs: release year sorts', () => {
  const data = [
    song({ songId: 's-2000', title: 'older', year: 2000 }),
    song({ songId: 's-1990', title: 'oldest', year: 1990 }),
    song({ songId: 's-none', title: 'no year' })
  ];

  test('releasedYearAscending', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'releasedYearAscending'))).toEqual([
      's-1990',
      's-2000',
      's-none'
    ]);
  });

  test('releasedYearDescending', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'releasedYearDescending'))).toEqual([
      's-2000',
      's-1990',
      's-none'
    ]);
  });
});

describe('sortSongs: track number sorts (disk number is the primary key)', () => {
  const data = [
    song({ songId: 's-d2t1', title: 'z', trackNo: 1, discNo: 2 }),
    song({ songId: 's-d1t3', title: 'y', trackNo: 3, discNo: 1 }),
    song({ songId: 's-d1t5', title: 'x', trackNo: 5, discNo: 1 })
  ];

  test('trackNoAscending orders by disk first, then track', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'trackNoAscending'))).toEqual([
      's-d1t3',
      's-d1t5',
      's-d2t1'
    ]);
  });

  test('trackNoDescending reverses both keys', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'trackNoDescending'))).toEqual([
      's-d2t1',
      's-d1t5',
      's-d1t3'
    ]);
  });

  test('leaves songs without track numbers in place', () => {
    const mixed = [
      song({ songId: 's-none', title: 'a' }),
      song({ songId: 's-t3', title: 'b', trackNo: 3 }),
      song({ songId: 's-t1', title: 'c', trackNo: 1 })
    ];
    expect(idsOf(sortSongs(blacklistRepository, mixed, 'trackNoAscending'))).toEqual([
      's-none',
      's-t1',
      's-t3'
    ]);
  });
});

describe('sortSongs: artist and album sorts', () => {
  test('artistNameAscending compares the joined artist list', () => {
    const data = [
      song({ songId: 's-multi', title: 'x', artists: [{ artistId: 'a1', name: 'Zed' }, { artistId: 'a2', name: 'Abba' }] }),
      song({ songId: 's-single', title: 'y', artists: [{ artistId: 'a3', name: 'Mid' }] })
    ];
    // 'mid' < 'zed,abba'
    expect(idsOf(sortSongs(blacklistRepository, data, 'artistNameAscending'))).toEqual([
      's-single',
      's-multi'
    ]);
  });

  test('artistNameDescending reverses the artist order', () => {
    const data = [
      song({ songId: 's-multi', title: 'x', artists: [{ artistId: 'a1', name: 'Zed' }, { artistId: 'a2', name: 'Abba' }] }),
      song({ songId: 's-single', title: 'y', artists: [{ artistId: 'a3', name: 'Mid' }] })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'artistNameDescending'))).toEqual([
      's-multi',
      's-single'
    ]);
  });

  test('albumNameAscending and albumNameDescending', () => {
    const data = [
      song({ songId: 's-b', title: 'x', album: { albumId: 'al1', name: 'Bravo' } }),
      song({ songId: 's-a', title: 'y', album: { albumId: 'al2', name: 'Alpha' } })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'albumNameAscending'))).toEqual(['s-a', 's-b']);
    expect(idsOf(sortSongs(blacklistRepository, data, 'albumNameDescending'))).toEqual(['s-b', 's-a']);
  });
});

describe('sortSongs: listening-based sorts', () => {
  const now = new Date();
  const thisMonthDay = new Date(now.getFullYear(), now.getMonth(), 10).getTime();
  const previousMonthDay = new Date(now.getFullYear(), now.getMonth() - 1, 10).getTime();
  const twoYearsAgo = new Date(now.getFullYear() - 2, 0, 1).getTime();

  const listening = (
    songId: string,
    entries: { dateMs: number; count: number }[]
  ): SongListeningData => ({
    songId,
    listens: [
      { year: now.getFullYear(), listens: entries.map((e) => [e.dateMs, e.count]) },
      { year: now.getFullYear() - 2, listens: [[twoYearsAgo, 7]] }
    ]
  });

  test('allTimeMostListened sums across every year', () => {
    const data = [
      song({ songId: 's-low', title: 'low' }),
      song({ songId: 's-high', title: 'high' })
    ];
    const listeningData = [
      listening('s-low', [{ dateMs: thisMonthDay, count: 1 }]),
      listening('s-high', [{ dateMs: previousMonthDay, count: 3 }])
    ];
    // s-low: 1 + 7 = 8; s-high: 3 + 7 = 10
    expect(idsOf(sortSongs(blacklistRepository, data, 'allTimeMostListened', listeningData))).toEqual([
      's-high',
      's-low'
    ]);
    expect(idsOf(sortSongs(blacklistRepository, data, 'allTimeLeastListened', listeningData))).toEqual([
      's-low',
      's-high'
    ]);
  });

  test('monthly sorts count only the current month', () => {
    const data = [
      song({ songId: 's-older', title: 'older' }),
      song({ songId: 's-current', title: 'current' })
    ];
    const listeningData = [
      listening('s-older', [{ dateMs: previousMonthDay, count: 9 }]),
      listening('s-current', [{ dateMs: thisMonthDay, count: 2 }])
    ];
    // current month: s-current 2, s-older 0 (the rest is previous-month/all-time)
    expect(idsOf(sortSongs(blacklistRepository, data, 'monthlyMostListened', listeningData))).toEqual([
      's-current',
      's-older'
    ]);
    expect(idsOf(sortSongs(blacklistRepository, data, 'monthlyLeastListened', listeningData))).toEqual([
      's-older',
      's-current'
    ]);
  });

  test('listening sorts are no-ops without listening data', () => {
    const data = [
      song({ songId: 's-1', title: 'x' }),
      song({ songId: 's-2', title: 'y' })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'allTimeMostListened'))).toEqual(['s-1', 's-2']);
  });
});

describe('sortSongs: date sorts keep their historical quirks', () => {
  test('dateAddedAscending puts the newest modifiedDate first; equal dates keep V8-stable order', () => {
    const data = [
      song({ songId: 's-a', title: 'a song', modifiedDate: 2020 }),
      song({ songId: 's-b', title: 'b song', modifiedDate: 2021 }),
      song({ songId: 's-c', title: 'c song', modifiedDate: 2020 })
    ];
    // s-b is the only 2021 song, so it leads; s-a and s-c share 2020 and the
    // double-sort comparator (a<b ? 1 : -1, i.e. "newer first" with -1 on ties)
    // leaves their relative order to the engine's stable sort — pinned here as
    // the exact output the production code produces.
    expect(idsOf(sortSongs(blacklistRepository, data, 'dateAddedAscending'))).toEqual([
      's-b',
      's-c',
      's-a'
    ]);
  });

  test('dateAddedAscending orders strictly by modifiedDate when the dates differ', () => {
    const data = [
      song({ songId: 's-old', title: 'a song', modifiedDate: 2020 }),
      song({ songId: 's-mid', title: 'b song', modifiedDate: 2021 }),
      song({ songId: 's-new', title: 'c song', modifiedDate: 2022 })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'dateAddedAscending'))).toEqual([
      's-new',
      's-mid',
      's-old'
    ]);
  });

  test('dateAddedDescending orders by addedDate ascending, titles ascending within a date', () => {
    const data = [
      song({ songId: 's-new', title: 'a song', addedDate: 2021 }),
      song({ songId: 's-old', title: 'b song', addedDate: 2020 })
    ];
    expect(idsOf(sortSongs(blacklistRepository, data, 'dateAddedDescending'))).toEqual([
      's-old',
      's-new'
    ]);
  });
});

describe('sortSongs: blacklist sorts', () => {
  const data = [
    song({ songId: 's-black', title: 'zeta' }),
    song({ songId: 's-white', title: 'alpha' })
  ];

  test('blacklistedSongs keeps only blacklisted songs, sorted aToZ', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'blacklistedSongs'))).toEqual(['s-black']);
  });

  test('whitelistedSongs keeps only the rest, sorted aToZ', () => {
    expect(idsOf(sortSongs(blacklistRepository, data, 'whitelistedSongs'))).toEqual(['s-white']);
  });
});
