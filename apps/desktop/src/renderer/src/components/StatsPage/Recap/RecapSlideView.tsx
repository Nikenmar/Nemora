import { useTranslation } from 'react-i18next';

import type { RecapSlide } from '@platform/core/stats/recap';

type Props = {
  slide: RecapSlide;
};

const RecapSlideView = ({ slide }: Props) => {
  const { t, i18n } = useTranslation();
  const number = (value: number) => value.toLocaleString(i18n.language);
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
      new Date(`${value}T12:00:00`)
    );
  const month = (value: number) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2000, value - 1, 1));
  const time = (seconds: number) => {
    const hours = Math.round(seconds / 3600);
    if (hours >= 1) return t('statsPage.recap.hours', { count: hours });
    return t('statsPage.recap.minutes', { count: Math.round(seconds / 60) });
  };

  switch (slide.kind) {
    case 'listening':
      return (
        <div className="flex max-w-4xl flex-col items-center text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">headphones</span>
          <p className="mb-3 text-xl opacity-70">{t('statsPage.recap.listeningEyebrow')}</p>
          <p className="text-7xl font-semibold tracking-tight sm:text-8xl">
            {number(slide.totalListens)}
          </p>
          <p className="mt-2 text-2xl">{t('statsPage.recap.listens')}</p>
          <p className="mt-8 text-lg opacity-75">{time(slide.approxListeningTimeSec)}</p>
          <p className="mt-2 text-sm opacity-55">
            {t('statsPage.recap.yearShare', {
              percent: Math.round(slide.yearShare * 100),
              year: slide.year
            })}
          </p>
        </div>
      );

    case 'topSongs':
      return (
        <div className="w-full max-w-3xl">
          <p className="mb-8 text-center text-4xl font-semibold sm:text-5xl">
            {t('statsPage.recap.topSongs')}
          </p>
          <ol className="space-y-3">
            {slide.songs.map((song, index) => (
              <li
                key={song.songId}
                className="flex items-center gap-4 rounded-xl bg-background-color-1/55 px-5 py-3 dark:bg-dark-background-color-1/55"
              >
                <span className="w-8 text-right text-2xl font-semibold opacity-45">
                  {index + 1}
                </span>
                <span className="min-w-0 grow">
                  <span className="block truncate text-xl font-medium">{song.title}</span>
                  <span className="block truncate text-sm opacity-60">
                    {song.artists.join(', ') || t('statsPage.recap.unknownArtist')}
                  </span>
                </span>
                <span className="shrink-0 text-lg font-medium">
                  {t('statsPage.recap.plays', { count: song.listens })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      );

    case 'topArtist':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">person</span>
          <p className="text-xl opacity-70">{t('statsPage.recap.topArtist')}</p>
          <p className="mt-4 text-6xl font-semibold tracking-tight sm:text-7xl">{slide.artist}</p>
          <p className="mt-6 text-xl">{t('statsPage.recap.plays', { count: slide.listens })}</p>
          <p className="mt-2 opacity-65">
            {t('statsPage.recap.peakMonth', {
              month: month(slide.peakMonth),
              count: slide.peakMonthListens
            })}
          </p>
        </div>
      );

    case 'mostActiveDay':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">calendar_month</span>
          <p className="text-xl opacity-70">{t('statsPage.recap.bestDay')}</p>
          <p className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
            {date(slide.date)}
          </p>
          <p className="mt-6 text-xl">
            {t('statsPage.recap.dayDetail', {
              count: slide.listens,
              title: slide.topSong.title
            })}
          </p>
        </div>
      );

    case 'discovery':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">auto_awesome</span>
          <p className="text-xl opacity-70">{t('statsPage.recap.discovery')}</p>
          <p className="mt-4 text-6xl font-semibold tracking-tight sm:text-7xl">
            {slide.song.title}
          </p>
          <p className="mt-3 text-xl opacity-70">
            {slide.song.artists.join(', ') || t('statsPage.recap.unknownArtist')}
          </p>
          <p className="mt-6">
            {t('statsPage.recap.discoveryDetail', { count: slide.song.listens })}
          </p>
        </div>
      );

    case 'longestStreak':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">
            local_fire_department
          </span>
          <p className="text-xl opacity-70">{t('statsPage.recap.streak')}</p>
          <p className="mt-4 text-7xl font-semibold tracking-tight sm:text-8xl">
            {t('statsPage.recap.streakDays', { count: slide.days })}
          </p>
          <p className="mt-6 opacity-65">
            {t('statsPage.recap.streakRange', {
              start: date(slide.startDate),
              end: date(slide.endDate)
            })}
          </p>
        </div>
      );

    case 'tierlist':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">leaderboard</span>
          <p className="text-xl opacity-70">{t('statsPage.recap.tierlist')}</p>
          <p className="mt-4 text-6xl font-semibold tracking-tight sm:text-7xl">
            {slide.song.title}
          </p>
          <p className="mt-6 text-xl">
            {t('statsPage.recap.tierlistDetail', {
              tier: slide.tierName,
              tierlist: slide.tierlistName
            })}
          </p>
        </div>
      );

    case 'eloClimber':
      return (
        <div className="max-w-4xl text-center">
          <span className="material-icons-round mb-5 text-7xl opacity-30">trending_up</span>
          <p className="text-xl opacity-70">{t('statsPage.recap.climber')}</p>
          <p className="mt-4 text-6xl font-semibold tracking-tight sm:text-7xl">
            {slide.song.title}
          </p>
          <p className="mt-6 text-xl">
            {t('statsPage.recap.climberDetail', {
              gain: number(slide.ratingGain),
              count: slide.duels
            })}
          </p>
        </div>
      );
  }
};

export default RecapSlideView;
