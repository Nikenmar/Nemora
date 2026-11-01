import { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { loadSmartLists, smartListsStore, type SmartListId } from '../../other/forYou';
import Button from '../Button';
import SecondaryContainer from '../SecondaryContainer';
import SongCard from '../SongsPage/SongCard';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

type Props = { noOfVisibleSongs: number };

/**
 * For you (PLAN/19 D1): the Rediscover shelf as it was, with the smart lists as tabs beside it.
 * Rediscover reads the system playlist exactly as before; a tab with no songs is not shown.
 */
const ForYouShelf = ({ noOfVisibleSongs }: Props) => {
  const { t } = useTranslation();
  const { changeCurrentActivePage } = useContext(AppUpdateContext);
  const lists = useStore(smartListsStore, (s) => s);
  const [rediscover, setRediscover] = useState<string[]>([]);
  const [active, setActive] = useState<SmartListId>('rediscover');
  const [songs, setSongs] = useState<SongData[]>([]);

  useEffect(() => {
    let isCancelled = false;
    window.api.playlistsData
      .getPlaylistData(['Rediscover'])
      .then(([playlist]) => !isCancelled && setRediscover(playlist?.songs ?? []))
      .catch(() => !isCancelled && setRediscover([]));
    loadSmartLists().catch((error) => console.error(error));
    return () => {
      isCancelled = true;
    };
  }, []);

  const tabs = useMemo(() => {
    const out: { id: SmartListId; ids: string[] }[] = [];
    if (rediscover.length > 0) out.push({ id: 'rediscover', ids: rediscover });
    for (const list of lists ?? []) {
      if (list.id !== 'rediscover') out.push({ id: list.id, ids: list.entries.map((e) => e.songId) });
    }
    return out;
  }, [lists, rediscover]);

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const visibleIds = useMemo(() => current?.ids.slice(0, noOfVisibleSongs) ?? [], [current, noOfVisibleSongs]);
  const key = visibleIds.join(',');

  useEffect(() => {
    if (visibleIds.length === 0) return setSongs([]);
    let isCancelled = false;
    window.api.audioLibraryControls
      .getSongInfo(visibleIds)
      .then((data) => {
        if (isCancelled || !data) return;
        setSongs(visibleIds.map((id) => data.find((s) => s.songId === id)).filter(Boolean) as SongData[]);
      })
      .catch(() => !isCancelled && setSongs([]));
    return () => {
      isCancelled = true;
    };
    // The ids' text is the dependency: a new array with the same songs fetches nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!current) return null;

  return (
    <SecondaryContainer className="for-you-container appear-from-bottom flex h-fit flex-col pb-8">
      <div className="title-container mb-3 flex items-center justify-between gap-4 pr-4">
        <div className="flex min-w-0 items-center gap-4">
          <h2 className="shrink-0 text-title font-semibold text-ink">{t('forYou.title')}</h2>
          <div role="tablist" aria-label={t('forYou.title')} className="flex min-w-0 gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === current.id}
                className={`h-7 shrink-0 rounded-full px-3 text-small outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo ${
                  tab.id === current.id ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-dim hover:text-ink'
                }`}
                onClick={() => setActive(tab.id)}
              >
                {t(`forYou.list.${tab.id}`)}
              </button>
            ))}
          </div>
        </div>
        <Button
          label={t('common.showAll')}
          variant="ghost"
          size="sm"
          className="show-all-btn !mr-0 shrink-0"
          clickHandler={() =>
            current.id === 'rediscover'
              ? changeCurrentActivePage('PlaylistInfo', { playlistId: 'Rediscover' })
              : changeCurrentActivePage('SmartList', { list: current.id })
          }
        />
      </div>
      <div
        role="tabpanel"
        style={{ gridTemplateColumns: `repeat(${noOfVisibleSongs},minmax(0,1fr))` }}
        className="songs-container grid gap-x-5 pr-4"
      >
        {songs.map((song, index) => (
          <SongCard
            index={index}
            key={song.songId}
            title={song.title}
            artworkPath={song.artworkPaths?.artworkPath || DefaultSongCover}
            path={song.path}
            songId={song.songId}
            artists={song.artists}
            album={song.album}
            palette={song.paletteData}
            isAFavorite={song.isAFavorite}
            isBlacklisted={song.isBlacklisted}
          />
        ))}
      </div>
    </SecondaryContainer>
  );
};

export default ForYouShelf;
