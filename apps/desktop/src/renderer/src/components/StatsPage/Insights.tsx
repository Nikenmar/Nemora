import { useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

type Insight =
  | { kind: 'week'; heardMs: number; beforeMs: number; songs: number; songsBefore: number; firstTime: number }
  | { kind: 'outOfRotation'; songs: string[]; plays: number[] }
  | { kind: 'rising'; songs: string[]; recent: number[]; before: number[] }
  | { kind: 'islands'; grew: [number, string, number, number] | null; faded: [number, string, number, number] | null }
  | { kind: 'hours'; from: number; to: number; share: number; plays: number };

const duration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

const Card = ({ icon, title, detail, action }: { icon: string; title: ReactNode; detail?: ReactNode; action?: ReactNode }) => (
  <div className="insight-card flex min-h-[8.5rem] flex-col gap-2 rounded-panel bg-surface-1 p-4">
    <div className="flex items-start gap-3">
      <span className="ms-icon mt-0.5 text-[22px] text-accent" aria-hidden>
        {icon}
      </span>
      <p className="text-body font-semibold leading-snug text-ink">{title}</p>
    </div>
    {detail && <p className="pl-9 text-small text-ink-dim">{detail}</p>}
    {action && <div className="mt-auto pl-7">{action}</div>}
  </div>
);

/**
 * Stats > Insights (PLAN/20 D3): a few sentences that read the history, above everything Stats
 * already shows; each appears only when the history supports it.
 */
const Insights = () => {
  const { t } = useTranslation();
  const { createQueue, changeCurrentActivePage } = useContext(AppUpdateContext);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let isLive = true;
    invoke<Insight[]>('stats_insights')
      .then(async (found) => {
        const ids = found.flatMap((i) => (i.kind === 'outOfRotation' || i.kind === 'rising' ? i.songs.slice(0, 3) : []));
        const songs = ids.length > 0 ? await window.api.audioLibraryControls.getSongInfo(ids) : [];
        if (!isLive) return;
        setTitles(new Map((songs ?? []).map((s) => [s.songId, s.title])));
        setInsights(found);
      })
      .catch(() => isLive && setInsights([]));
    return () => {
      isLive = false;
    };
  }, []);

  if (insights.length === 0) return null;

  const names = (ids: string[]) =>
    ids
      .slice(0, 3)
      .map((id) => titles.get(id))
      .filter(Boolean)
      .join(', ');
  const play = (ids: string[]) => (
    <Button
      label={t('insights.playThem')}
      iconName="play_arrow"
      className="!mr-0 text-sm"
      clickHandler={() => createQueue(ids, 'songs', false, undefined, true)}
    />
  );

  const cards = insights.map((insight) => {
    switch (insight.kind) {
      case 'week':
        return (
          <Card
            key="week"
            icon={insight.heardMs >= insight.beforeMs ? 'trending_up' : 'trending_down'}
            title={t('insights.week', { time: duration(insight.heardMs), count: insight.songs })}
            detail={t('insights.weekDetail', {
              first: insight.firstTime,
              before: duration(insight.beforeMs),
              songsBefore: insight.songsBefore
            })}
          />
        );
      case 'outOfRotation':
        return (
          <Card
            key="rotation"
            icon="history"
            title={t('insights.outOfRotation', { count: insight.songs.length })}
            detail={names(insight.songs)}
            action={play(insight.songs)}
          />
        );
      case 'rising':
        return (
          <Card
            key="rising"
            icon="north_east"
            title={t('insights.rising', { count: insight.songs.length })}
            detail={names(insight.songs)}
            action={play(insight.songs)}
          />
        );
      case 'islands':
        return (
          <Card
            key="islands"
            icon="explore"
            title={
              insight.grew
                ? t('insights.islandGrew', { name: insight.grew[1], now: insight.grew[2], before: insight.grew[3] })
                : t('insights.islandFaded', { name: insight.faded?.[1], now: insight.faded?.[2], before: insight.faded?.[3] })
            }
            detail={
              insight.grew && insight.faded
                ? t('insights.islandFaded', { name: insight.faded[1], now: insight.faded[2], before: insight.faded[3] })
                : undefined
            }
            action={
              <Button
                label={t('insights.openMap')}
                iconName="explore"
                className="!mr-0 text-sm"
                clickHandler={() => changeCurrentActivePage('TasteMap')}
              />
            }
          />
        );
      case 'hours':
        return (
          <Card
            key="hours"
            icon="schedule"
            title={t('insights.hours', { from: hour(insight.from), to: hour(insight.to) })}
            detail={t('insights.hoursDetail', { share: Math.round(insight.share * 100), plays: insight.plays })}
          />
        );
      default:
        return null;
    }
  });

  return (
    <section className="insights mb-6" aria-label={t('insights.title')}>
      <h2 className="mb-3 text-section font-semibold text-ink">{t('insights.title')}</h2>
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-2 sm:grid-cols-1">{cards}</div>
    </section>
  );
};

export default Insights;
