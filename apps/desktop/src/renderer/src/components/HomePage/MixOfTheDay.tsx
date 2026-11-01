import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { loadMix, mixStore, mixSummary } from '../../other/forYou';
import Button from '../Button';
import Img from '../Img';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

export const formatLength = (seconds: number, t: TFunction): string => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? t('forYou.lengthHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('forYou.lengthMinutes', { minutes });
};

/**
 * Today's second card (PLAN/19 D2): the mix of the day, made once a day from Smart Shuffle's
 * favourites, forgotten favourites, songs never heard and an island of the taste map. Play starts
 * it; the card opens it as a page; New mix makes another.
 */
const MixOfTheDay = () => {
  const { t } = useTranslation();
  const { createQueue, changeCurrentActivePage } = useContext(AppUpdateContext);
  const mix = useStore(mixStore, (s) => s);
  const [covers, setCovers] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [isMaking, setIsMaking] = useState(false);

  useEffect(() => {
    loadMix().catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    if (!mix || mix.songs.length === 0) return undefined;
    let isLive = true;
    window.api.audioLibraryControls
      .getSongInfo(mix.songs.map((s) => s.songId))
      .then((songs) => {
        if (!isLive || !songs) return;
        const seen = new Set<string>();
        const art: string[] = [];
        for (const song of songs) {
          const path = song.artworkPaths?.optimizedArtworkPath;
          if (path && !song.artworkPaths?.isDefaultArtwork && !seen.has(path) && art.length < 4) {
            seen.add(path);
            art.push(path);
          }
        }
        setCovers(art);
        setSeconds(songs.reduce((sum, s) => sum + (s.duration || 0), 0));
      })
      .catch(() => undefined);
    return () => {
      isLive = false;
    };
  }, [mix]);

  if (!mix || mix.songs.length === 0) return null;

  const ids = mix.songs.map((s) => s.songId);
  const tiles = [0, 1, 2, 3].map((i) => covers[i % Math.max(1, covers.length)] ?? DefaultSongCover);
  const open = () => changeCurrentActivePage('SmartList', { list: 'mix' });

  return (
    <section
      className="mix-of-the-day relative flex min-w-[19rem] flex-1 cursor-pointer items-center gap-5 overflow-hidden rounded-panel bg-surface-1 p-5 outline-none transition-colors duration-150 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-echo"
      aria-label={t('forYou.mixTitle')}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open();
      }}
    >
      <div className="grid h-[9.5rem] w-[9.5rem] shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-cover-lg shadow-[0_14px_34px_rgb(0_0_0/0.35)]">
        {tiles.map((src, i) => (
          <Img key={i} src={src} fallbackSrc={DefaultSongCover} alt="" className="h-full w-full object-cover" />
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-small text-ink-dim">{t('forYou.madeToday')}</p>
        <h2 className="mt-1 truncate text-title font-semibold text-ink">{t('forYou.mixTitle')}</h2>
        <p className="mt-1 line-clamp-2 text-small text-ink-dim">{mixSummary(mix, t)}</p>
        <p className="mt-1 text-small text-ink-dim">
          {t('forYou.songCount', { count: ids.length })}
          {seconds > 0 && ` · ${formatLength(seconds, t)}`}
        </p>
        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            label={t('forYou.play')}
            iconName="play_arrow"
            variant="primary"
            className="!mr-0"
            clickHandler={() => createQueue(ids, 'songs', false, undefined, true)}
          />
          <Button
            tooltipLabel={t('forYou.newMix')}
            iconName="autorenew"
            variant="ghost"
            className="!mr-0"
            isDisabled={isMaking}
            clickHandler={() => {
              setIsMaking(true);
              loadMix(true)
                .catch((error) => console.error(error))
                .finally(() => setIsMaking(false));
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default MixOfTheDay;
