import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store';
import Button from '../Button';
import Img from '../Img';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

type Props = {
  /** What was played last, for when nothing is loaded in the player yet. */
  lastPlayed?: SongData | AudioInfo;
  /** Beside the mix of the day (PLAN/19 D1): narrower, Up next only on wide windows. */
  isInRow?: boolean;
};

/**
 * The top of Home: the song in the player (or the last one played) with Resume, the queue, and the
 * next three songs. Its background is the cover light.
 */
const ContinueHero = ({ lastPlayed, isInRow = false }: Props) => {
  const { t } = useTranslation();
  const { toggleSongPlayback, playSong, changeCurrentActivePage } = useContext(AppUpdateContext);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const [upNext, setUpNext] = useState<SongData[]>([]);

  const hasCurrent = !!currentSongData?.songId;
  const title = hasCurrent ? currentSongData.title : lastPlayed?.title;
  const artists = hasCurrent ? currentSongData.artists : lastPlayed?.artists;
  const artwork = hasCurrent
    ? currentSongData.artworkPath
    : lastPlayed?.artworkPaths?.artworkPath;

  useEffect(() => {
    if (queue.currentSongIndex === null || queue.queue.length === 0) return setUpNext([]);
    const ids = queue.queue.slice(queue.currentSongIndex + 1, queue.currentSongIndex + 4);
    if (ids.length === 0) return setUpNext([]);
    const controller = new AbortController();
    window.api.audioLibraryControls
      .getSongInfo(ids)
      .then((songs) => {
        if (controller.signal.aborted || !songs) return;
        setUpNext(ids.map((id) => songs.find((song) => song.songId === id)).filter(Boolean) as SongData[]);
      })
      .catch(() => setUpNext([]));
    return () => controller.abort();
  }, [queue.currentSongIndex, queue.queue]);

  if (!title) return null;

  const remaining =
    queue.currentSongIndex === null ? 0 : Math.max(0, queue.queue.length - queue.currentSongIndex - 1);

  return (
    <section
      className={`continue-hero relative grid shrink-0 items-center gap-7 overflow-hidden rounded-panel bg-surface-1 p-5 ${
        isInRow
          ? 'min-w-0 flex-[1.7] grid-cols-[auto_minmax(0,1fr)_minmax(0,15rem)] xl:grid-cols-[auto_minmax(0,1fr)]'
          : 'mb-8 mr-4 grid-cols-[auto_minmax(0,1fr)_minmax(0,17rem)] lg:grid-cols-[auto_minmax(0,1fr)]'
      }`}
      aria-label={t('homePage.continue', 'Continue where you left off')}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(28rem_14rem_at_10%_50%,color-mix(in_srgb,var(--cover-glow)_var(--cover-glow-strength),transparent),transparent_75%)]"
      />
      <Img
        src={artwork}
        fallbackSrc={DefaultSongCover}
        alt=""
        className="relative h-[9.5rem] w-[9.5rem] rounded-cover-lg object-cover shadow-[0_14px_34px_rgb(0_0_0/0.35)]"
      />
      <div className="relative min-w-0">
        <p className="text-small text-ink-dim">{t('homePage.continue', 'Continue where you left off')}</p>
        <h2 className="mt-1 truncate text-hero font-semibold text-ink" title={title}>
          {title}
        </h2>
        <p className="mt-0.5 truncate text-body text-ink-dim">
          {artists && artists.length > 0
            ? artists.map((artist) => artist.name).join(', ')
            : t('common.unknownArtist')}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button
            label={
              hasCurrent && isPlaying ? t('player.pause', 'Pause') : t('homePage.resume', 'Resume')
            }
            iconName={hasCurrent && isPlaying ? 'pause' : 'play_arrow'}
            variant="primary"
            className="!mr-0"
            clickHandler={() => {
              if (hasCurrent) toggleSongPlayback();
              else if (lastPlayed) playSong(lastPlayed.songId);
            }}
          />
          {remaining > 0 && (
            <Button
              label={t('homePage.queueWithCount', 'Queue, {{count}} songs', { count: remaining })}
              iconName="queue_music"
              className="!mr-0"
              clickHandler={() => changeCurrentActivePage('CurrentQueue')}
            />
          )}
        </div>
      </div>
      {upNext.length > 0 && (
        <div
          className={`relative flex min-w-0 flex-col gap-2.5 border-l border-line pl-5 ${isInRow ? 'xl:hidden' : 'lg:hidden'}`}
        >
          <p className="text-small text-ink-dim">{t('homePage.upNext', 'Up next')}</p>
          {upNext.map((song) => (
            <button
              type="button"
              key={song.songId}
              className="flex min-w-0 items-center gap-2.5 rounded-lg text-left outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-echo"
              onClick={() => playSong(song.songId)}
            >
              <Img
                src={song.artworkPaths?.optimizedArtworkPath}
                fallbackSrc={DefaultSongCover}
                alt=""
                className="h-9 w-9 shrink-0 rounded-cover-sm object-cover"
              />
              <span className="min-w-0">
                <span className="block truncate text-small font-medium text-ink">{song.title}</span>
                <span className="block truncate text-micro text-ink-dim">
                  {song.artists?.map((artist) => artist.name).join(', ') || t('common.unknownArtist')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export default ContinueHero;
