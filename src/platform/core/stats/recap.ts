export type RecapPeriod =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number };

export interface RecapInput {
  songs: readonly SavableSongData[];
  listeningData: readonly SongListeningData[];
  tierlists?: readonly SavableTierlist[];
  cmrStats?: CmrStatsData;
}

export interface RecapSongCount {
  songId: string;
  title: string;
  artists: string[];
  listens: number;
}

export type RecapSlide =
  | {
      kind: 'listening';
      totalListens: number;
      approxListeningTimeSec: number;
      year: number;
      yearTotalListens: number;
      yearShare: number;
    }
  | { kind: 'topSongs'; songs: RecapSongCount[] }
  | {
      kind: 'topArtist';
      artist: string;
      listens: number;
      peakMonth: number;
      peakMonthListens: number;
    }
  | {
      kind: 'mostActiveDay';
      date: string;
      listens: number;
      topSong: RecapSongCount;
    }
  | { kind: 'discovery'; song: RecapSongCount; firstListenDate: string }
  | { kind: 'longestStreak'; days: number; startDate: string; endDate: string }
  | {
      kind: 'tierlist';
      song: RecapSongCount;
      tierlistName: string;
      tierName: string;
    }
  | { kind: 'eloClimber'; song: RecapSongCount; ratingGain: number; duels: number };

interface PeriodBounds {
  start: number;
  end: number;
  yearStart: number;
  yearEnd: number;
}

interface ListenEvent {
  songId: string;
  at: number;
  date: string;
  count: number;
}

const getPeriodBounds = (period: RecapPeriod): PeriodBounds => {
  if (!Number.isInteger(period.year)) throw new RangeError('Recap year must be an integer.');
  if (
    period.kind === 'month' &&
    (!Number.isInteger(period.month) || period.month < 1 || period.month > 12)
  )
    throw new RangeError('Recap month must be an integer from 1 to 12.');

  const start =
    period.kind === 'month'
      ? new Date(period.year, period.month - 1, 1).getTime()
      : new Date(period.year, 0, 1).getTime();
  const end =
    period.kind === 'month'
      ? new Date(period.year, period.month, 1).getTime()
      : new Date(period.year + 1, 0, 1).getTime();

  return {
    start,
    end,
    yearStart: new Date(period.year, 0, 1).getTime(),
    yearEnd: new Date(period.year + 1, 0, 1).getTime()
  };
};

const toISODate = (at: number) => {
  const date = new Date(at);
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0')
  ].join('-');
};

const dayOrdinal = (isoDate: string) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const toSongCount = (song: SavableSongData, listens: number): RecapSongCount => ({
  songId: song.songId,
  title: song.title,
  artists: song.artists?.map((artist) => artist.name) ?? [],
  listens
});

const compareSongCounts = (a: RecapSongCount, b: RecapSongCount) =>
  b.listens - a.listens || a.title.localeCompare(b.title) || a.songId.localeCompare(b.songId);

const longestStreak = (dates: Iterable<string>) => {
  const sorted = [...new Set(dates)].sort();
  let best: { days: number; startDate: string; endDate: string } | undefined;
  let runStart = '';
  let previousOrdinal = Number.NEGATIVE_INFINITY;

  for (const date of sorted) {
    const ordinal = dayOrdinal(date);
    if (ordinal !== previousOrdinal + 1) runStart = date;
    const days = ordinal - dayOrdinal(runStart) + 1;
    if (!best || days > best.days) best = { days, startDate: runStart, endDate: date };
    previousOrdinal = ordinal;
  }

  return best;
};

/** Build deterministic, presentation-ready recap slides without reading stores or clocks. */
export const buildRecap = (input: RecapInput, period: RecapPeriod): RecapSlide[] => {
  const bounds = getPeriodBounds(period);
  const songsById = new Map(input.songs.map((song) => [song.songId, song]));
  const allEvents: ListenEvent[] = [];

  for (const row of input.listeningData) {
    if (!songsById.has(row.songId)) continue;
    for (const yearly of row.listens ?? [])
      for (const [at, count] of yearly.listens)
        if (count > 0) allEvents.push({ songId: row.songId, at, date: toISODate(at), count });
  }

  const periodEvents = allEvents.filter(
    (event) => event.at >= bounds.start && event.at < bounds.end
  );
  const yearEvents = allEvents.filter(
    (event) => event.at >= bounds.yearStart && event.at < bounds.yearEnd
  );
  const listensBySong = new Map<string, number>();
  for (const event of periodEvents)
    listensBySong.set(event.songId, (listensBySong.get(event.songId) ?? 0) + event.count);

  const totalListens = periodEvents.reduce((sum, event) => sum + event.count, 0);
  const yearTotalListens = yearEvents.reduce((sum, event) => sum + event.count, 0);
  const approxListeningTimeSec = [...listensBySong].reduce(
    (sum, [songId, count]) => sum + (songsById.get(songId)?.duration ?? 0) * count,
    0
  );
  const slides: RecapSlide[] = [
    {
      kind: 'listening',
      totalListens,
      approxListeningTimeSec: Math.round(approxListeningTimeSec),
      year: period.year,
      yearTotalListens,
      yearShare: yearTotalListens > 0 ? totalListens / yearTotalListens : 0
    }
  ];

  const rankedSongs = [...listensBySong]
    .map(([songId, listens]) => toSongCount(songsById.get(songId)!, listens))
    .sort(compareSongCounts);
  if (rankedSongs.length > 0) slides.push({ kind: 'topSongs', songs: rankedSongs.slice(0, 5) });

  const artistListens = new Map<
    string,
    { name: string; listens: number; months: Map<number, number> }
  >();
  for (const event of periodEvents) {
    const song = songsById.get(event.songId)!;
    const month = new Date(event.at).getMonth() + 1;
    for (const artist of song.artists ?? []) {
      const key = artist.artistId || artist.name.trim().toLowerCase();
      const aggregate = artistListens.get(key) ?? {
        name: artist.name,
        listens: 0,
        months: new Map()
      };
      aggregate.listens += event.count;
      aggregate.months.set(month, (aggregate.months.get(month) ?? 0) + event.count);
      artistListens.set(key, aggregate);
    }
  }
  const topArtist = [...artistListens.values()].sort(
    (a, b) => b.listens - a.listens || a.name.localeCompare(b.name)
  )[0];
  if (topArtist) {
    const [peakMonth, peakMonthListens] = [...topArtist.months].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0]
    )[0];
    slides.push({
      kind: 'topArtist',
      artist: topArtist.name,
      listens: topArtist.listens,
      peakMonth,
      peakMonthListens
    });
  }

  const eventsByDay = new Map<string, ListenEvent[]>();
  for (const event of periodEvents) {
    const events = eventsByDay.get(event.date) ?? [];
    events.push(event);
    eventsByDay.set(event.date, events);
  }
  const activeDay = [...eventsByDay].sort(
    (a, b) =>
      b[1].reduce((sum, event) => sum + event.count, 0) -
        a[1].reduce((sum, event) => sum + event.count, 0) || a[0].localeCompare(b[0])
  )[0];
  if (activeDay) {
    const daySongCounts = new Map<string, number>();
    for (const event of activeDay[1])
      daySongCounts.set(event.songId, (daySongCounts.get(event.songId) ?? 0) + event.count);
    const topSong = [...daySongCounts]
      .map(([songId, listens]) => toSongCount(songsById.get(songId)!, listens))
      .sort(compareSongCounts)[0];
    slides.push({
      kind: 'mostActiveDay',
      date: activeDay[0],
      listens: activeDay[1].reduce((sum, event) => sum + event.count, 0),
      topSong
    });
  }

  const firstListenBySong = new Map<string, number>();
  for (const event of allEvents) {
    const first = firstListenBySong.get(event.songId);
    if (first === undefined || event.at < first) firstListenBySong.set(event.songId, event.at);
  }
  const discovery = rankedSongs.find((song) => {
    const firstListen = firstListenBySong.get(song.songId);
    return (
      song.listens >= 2 &&
      firstListen !== undefined &&
      firstListen >= bounds.start &&
      firstListen < bounds.end
    );
  });
  if (discovery)
    slides.push({
      kind: 'discovery',
      song: discovery,
      firstListenDate: toISODate(firstListenBySong.get(discovery.songId)!)
    });

  const streak = longestStreak(eventsByDay.keys());
  if (streak) slides.push({ kind: 'longestStreak', ...streak });

  const tierlistCandidates = (input.tierlists ?? []).flatMap((tierlist) =>
    tierlist.tiers.flatMap((tier, tierIndex) =>
      tier.items.flatMap((songId) => {
        const song = songsById.get(songId);
        const listens = listensBySong.get(songId) ?? 0;
        return song && listens > 0
          ? [{ tierlist, tier, tierIndex, song: toSongCount(song, listens) }]
          : [];
      })
    )
  );
  const tierlistHighlight = tierlistCandidates.sort(
    (a, b) =>
      a.tierIndex - b.tierIndex ||
      compareSongCounts(a.song, b.song) ||
      a.tierlist.name.localeCompare(b.tierlist.name)
  )[0];
  if (tierlistHighlight)
    slides.push({
      kind: 'tierlist',
      song: tierlistHighlight.song,
      tierlistName: tierlistHighlight.tierlist.name,
      tierName: tierlistHighlight.tier.name
    });

  const eloChanges = new Map<string, { gain: number; duels: number }>();
  for (const duel of input.cmrStats?.elo.history ?? []) {
    if (duel.at < bounds.start || duel.at >= bounds.end) continue;
    for (const [songId, delta] of [
      [duel.songAId, duel.deltaA],
      [duel.songBId, duel.deltaB]
    ] as const) {
      if (!songsById.has(songId)) continue;
      const aggregate = eloChanges.get(songId) ?? { gain: 0, duels: 0 };
      aggregate.gain += delta;
      aggregate.duels += 1;
      eloChanges.set(songId, aggregate);
    }
  }
  const climber = [...eloChanges]
    .filter(([, change]) => change.gain > 0)
    .sort(
      (a, b) =>
        b[1].gain - a[1].gain ||
        songsById.get(a[0])!.title.localeCompare(songsById.get(b[0])!.title)
    )[0];
  if (climber)
    slides.push({
      kind: 'eloClimber',
      song: toSongCount(songsById.get(climber[0])!, listensBySong.get(climber[0]) ?? 0),
      ratingGain: Number(climber[1].gain.toFixed(1)),
      duels: climber[1].duels
    });

  return slides;
};

export default buildRecap;
