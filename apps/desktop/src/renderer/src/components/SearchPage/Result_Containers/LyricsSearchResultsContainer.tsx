import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipc, type Hit_Serialize } from '@platform/ipc';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import { store } from '../../../store';
import Button from '../../Button';
import Img from '../../Img';
import SecondaryContainer from '../../SecondaryContainer';

import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';

type Hit = Hit_Serialize;

/** Plays `songId` and, once it is the song in the player, moves to `seconds`. */
export const playFrom = (
  songId: string,
  seconds: number | null,
  playSong: (songId: string, isStartPlay?: boolean) => void,
  seek: (position: number) => void
) => {
  playSong(songId, true);
  if (seconds === null || seconds <= 0) return;
  const startedAt = Date.now();
  const tick = () => {
    if (store.state.currentSongData.songId === songId) {
      seek(seconds);
      return;
    }
    if (Date.now() - startedAt < 4000) setTimeout(tick, 50);
  };
  tick();
};

/**
 * In lyrics (PLAN/19 D6): songs with a line matching the search, the line with a little context,
 * and Play from this line (synced lyrics start at the line; plain ones at the beginning).
 */
const LyricsSearchResultsContainer = ({ searchInput }: { searchInput: string }) => {
  const { t } = useTranslation();
  const { playSong, updateSongPosition } = useContext(AppUpdateContext);
  const [hits, setHits] = useState<(Hit & { song?: SongData })[]>([]);

  useEffect(() => {
    const query = searchInput.trim();
    if (query.length < 3) return setHits([]);
    let isLive = true;
    const timer = setTimeout(() => {
      ipc('lyrics_search', { query, limit: 6 })
        .then(async (found) => {
          const songs = found.length > 0 ? await window.api.audioLibraryControls.getSongInfo(found.map((h) => h.songId)) : [];
          if (!isLive) return;
          setHits(found.map((h) => ({ ...h, song: songs?.find((s) => s.songId === h.songId) })).filter((h) => h.song));
        })
        .catch(() => isLive && setHits([]));
    }, 250);
    return () => {
      isLive = false;
      clearTimeout(timer);
    };
  }, [searchInput]);

  if (hits.length === 0) return null;

  return (
    <SecondaryContainer className="lyrics-search-results-container mb-8 mt-4">
      <h2 className="mb-3 text-title font-semibold text-ink">{t('lyricsSearch.title')}</h2>
      <ul className="flex flex-col gap-1 pr-4">
        {hits.map((hit) => (
          <li
            key={hit.songId}
            className="lyrics-hit flex items-center gap-4 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-surface-2/60"
          >
            <Img
              src={hit.song?.artworkPaths?.optimizedArtworkPath}
              fallbackSrc={DefaultSongCover}
              alt=""
              className="h-12 w-12 shrink-0 rounded-cover-sm object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-small text-ink-dim">
                {hit.song?.title}
                {hit.song?.artists && hit.song.artists.length > 0 && ` · ${hit.song.artists.map((a) => a.name).join(', ')}`}
              </p>
              {hit.before && <p className="truncate text-micro text-ink-dim/70">{hit.before}</p>}
              <p className="truncate font-medium text-ink">{hit.text}</p>
              {hit.after && <p className="truncate text-micro text-ink-dim/70">{hit.after}</p>}
            </div>
            <Button
              label={hit.start !== null ? t('lyricsSearch.playFromLine') : t('lyricsSearch.play')}
              iconName="play_arrow"
              className="!mr-0 shrink-0"
              clickHandler={() => playFrom(hit.songId, hit.start, playSong, updateSongPosition)}
            />
          </li>
        ))}
      </ul>
    </SecondaryContainer>
  );
};

export default LyricsSearchResultsContainer;
