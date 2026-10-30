import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import SecondaryContainer from '../SecondaryContainer';
import SongCard from '../SongsPage/SongCard';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

type Props = { noOfVisibleSongs: number };

/** Songs you loved and have not heard in a while: the start of the Rediscover playlist. */
const RediscoverShelf = ({ noOfVisibleSongs }: Props) => {
  const { t } = useTranslation();
  const { changeCurrentActivePage } = useContext(AppUpdateContext);
  const [songs, setSongs] = useState<SongData[]>([]);

  useEffect(() => {
    let isCancelled = false;
    window.api.playlistsData
      .getPlaylistData(['Rediscover'])
      .then(async ([playlist]) => {
        const ids = playlist?.songs?.slice(0, noOfVisibleSongs) ?? [];
        const data = ids.length > 0 ? await window.api.audioLibraryControls.getSongInfo(ids) : [];
        if (!isCancelled) setSongs(data ?? []);
      })
      .catch(() => !isCancelled && setSongs([]));
    return () => {
      isCancelled = true;
    };
  }, [noOfVisibleSongs]);

  if (songs.length === 0) return null;

  return (
    <SecondaryContainer className="rediscover-container appear-from-bottom flex h-fit flex-col pb-8">
      <div className="title-container mb-3 flex items-center justify-between pr-4">
        <h2 className="text-title font-semibold text-ink">{t('homePage.rediscover', 'Rediscover')}</h2>
        <Button
          label={t('common.showAll')}
          variant="ghost"
          size="sm"
          className="show-all-btn !mr-0"
          clickHandler={() => changeCurrentActivePage('PlaylistInfo', { playlistId: 'Rediscover' })}
        />
      </div>
      <div
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

export default RediscoverShelf;
