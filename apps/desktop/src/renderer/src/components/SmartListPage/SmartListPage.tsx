import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store, selectPreferences } from '../../store';
import {
  loadMix,
  loadSmartLists,
  mixStore,
  mixSummary,
  partText,
  reasonText,
  smartListsStore,
  type SmartListId
} from '../../other/forYou';
import MainContainer from '../MainContainer';
import TitleContainer from '../TitleContainer';
import Song from '../SongsPage/Song';
import { formatLength } from '../HomePage/MixOfTheDay';

/**
 * A smart list or the mix of the day as a page (PLAN/19 D4): read-only, each song with why it is
 * here; Play, Shuffle, Save as playlist, and for the mix New mix.
 */
const SmartListPage = () => {
  const { t } = useTranslation();
  const { createQueue, playSong, addNewNotifications } = useContext(AppUpdateContext);
  const page = useStore(store, (state) => state.currentlyActivePage);
  const preferences = useStore(store, selectPreferences('isSongIndexingEnabled'));
  const which = (page.data?.list as SmartListId | 'mix' | undefined) ?? 'mix';
  const mix = useStore(mixStore, (s) => s);
  const lists = useStore(smartListsStore, (s) => s);
  const [songs, setSongs] = useState<SongData[]>([]);

  useEffect(() => {
    if (which === 'mix' && !mixStore.state) loadMix().catch((error) => console.error(error));
    if (which !== 'mix' && !smartListsStore.state) loadSmartLists().catch((error) => console.error(error));
  }, [which]);

  const entries = useMemo(() => {
    if (which === 'mix') return (mix?.songs ?? []).map((s) => ({ songId: s.songId, why: partText(s.part, mix, t) }));
    const list = lists?.find((l) => l.id === which);
    return (list?.entries ?? []).map((e) => ({ songId: e.songId, why: reasonText(e.reason, t) }));
  }, [which, mix, lists, t]);

  const key = entries.map((e) => e.songId).join(',');
  useEffect(() => {
    const ids = entries.map((e) => e.songId);
    if (ids.length === 0) return setSongs([]);
    let isLive = true;
    window.api.audioLibraryControls
      .getSongInfo(ids)
      .then((data) => {
        if (!isLive || !data) return;
        setSongs(ids.map((id) => data.find((s) => s.songId === id)).filter(Boolean) as SongData[]);
      })
      .catch(() => isLive && setSongs([]));
    return () => {
      isLive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const playable = useMemo(() => songs.filter((s) => !s.isBlacklisted).map((s) => s.songId), [songs]);
  const why = useMemo(() => new Map(entries.map((e) => [e.songId, e.why])), [entries]);
  const title = which === 'mix' ? t('forYou.mixTitle') : t(`forYou.list.${which}`);
  const seconds = songs.reduce((sum, s) => sum + (s.duration || 0), 0);

  const saveAsPlaylist = useCallback(() => {
    const name = which === 'mix' ? `${t('forYou.mixTitle')} ${mix?.day ?? ''}`.trim() : title;
    window.api.playlistsData
      .addNewPlaylist(name, playable)
      .then((res) =>
        addNewNotifications([
          {
            id: 'smartListSaved',
            duration: 5000,
            content: res?.success ? t('forYou.saved', { name }) : t('forYou.saveFailed')
          }
        ])
      )
      .catch((error) => console.error(error));
  }, [addNewNotifications, mix?.day, playable, t, title, which]);

  return (
    <MainContainer className="main-container smart-list-page !h-full overflow-y-auto px-8 !pr-0 pb-8">
      <TitleContainer
        title={title}
        className="pr-4"
        buttons={[
          {
            label: t('common.playAll'),
            variant: 'primary',
            iconName: 'play_arrow',
            clickHandler: () => createQueue(playable, 'songs', false, undefined, true),
            isDisabled: playable.length === 0
          },
          {
            tooltipLabel: t('common.shuffleAndPlay'),
            iconName: 'shuffle',
            clickHandler: () => createQueue(playable, 'songs', true, undefined, true),
            isDisabled: playable.length === 0
          },
          {
            label: t('forYou.newMix'),
            iconName: 'autorenew',
            isVisible: which === 'mix',
            clickHandler: (_, setIsDisabled) => {
              setIsDisabled(true);
              loadMix(true)
                .catch((error) => console.error(error))
                .finally(() => setIsDisabled(false));
            }
          },
          {
            label: t('forYou.saveAsPlaylist'),
            iconName: 'playlist_add',
            clickHandler: saveAsPlaylist,
            isDisabled: playable.length === 0
          }
        ]}
      />
      <p className="mb-4 pr-4 text-small text-ink-dim">
        {which === 'mix' && mix ? `${mixSummary(mix, t)} · ` : ''}
        {t('forYou.songCount', { count: songs.length })}
        {seconds > 0 && ` · ${formatLength(seconds, t)}`}
      </p>
      <div className="pr-4">
        {songs.map((song, index) => (
          <div key={song.songId} className="smart-list-row">
            <Song
              index={index}
              isIndexingSongs={preferences.isSongIndexingEnabled}
              onPlayClick={(id) => {
                createQueue(playable, 'songs', false, undefined, false);
                playSong(id, true);
              }}
              {...song}
              trackNo={undefined}
            />
            <p className="-mt-1 mb-2 truncate pl-[3.7rem] text-micro text-ink-dim">{why.get(song.songId)}</p>
          </div>
        ))}
      </div>
      {songs.length === 0 && (
        <div className="no-songs-container flex h-1/2 flex-col items-center justify-center text-center text-ink-dim">
          <span className="ms-icon mb-4 text-5xl">brightness_empty</span>
          {t('forYou.empty')}
        </div>
      )}
    </MainContainer>
  );
};

export default SmartListPage;
