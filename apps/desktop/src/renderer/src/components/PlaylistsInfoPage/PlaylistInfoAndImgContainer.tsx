import { useTranslation } from 'react-i18next';
import HeroHeader from '../ui/HeroHeader';
import calculateTimeFromSeconds from '../../utils/calculateTimeFromSeconds';

import MultipleArtworksCover from '../PlaylistsPage/MultipleArtworksCover';
import DefaultPlaylistCover from '../../assets/images/webp/playlist_cover_default.webp';
import { useMemo } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

type Props = {
  playlist: Playlist;
  songs: SongData[];
};

const PlaylistInfoAndImgContainer = (props: Props) => {
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const { t } = useTranslation();

  const { playlist, songs } = props;

  const totalPlaylistDuration = useMemo(() => {
    const { timeString } = calculateTimeFromSeconds(
      songs.reduce((prev, current) => prev + current.duration, 0)
    );
    return timeString;
  }, [songs]);

  return (
    <>
      {playlist?.songs && (
        <HeroHeader
          artwork={playlist.artworkPaths ? playlist.artworkPaths.artworkPath : DefaultPlaylistCover}
          artworkNode={
            preferences.enableArtworkFromSongCovers && playlist.songs.length > 1 ? (
              <MultipleArtworksCover songIds={playlist.songs} className="h-full w-full" type={1} />
            ) : undefined
          }
          kind={t('common.playlist_one')}
          title={playlist.name}
          meta={[
            t('common.songWithCount', { count: playlist.songs.length }),
            songs.length > 0 ? totalPlaylistDuration : undefined,
            t('playlistsPage.createdOn', {
              val: new Date(playlist.createdDate),
              formatParams: { val: { year: 'numeric', month: 'long', day: 'numeric' } }
            })
          ]}
        />
      )}
    </>
  );
};

export default PlaylistInfoAndImgContainer;
