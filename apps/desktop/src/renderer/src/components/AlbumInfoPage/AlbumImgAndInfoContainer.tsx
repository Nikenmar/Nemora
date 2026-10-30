import { useMemo } from 'react';
import HeroHeader from '../ui/HeroHeader';
import { useTranslation } from 'react-i18next';
import calculateTimeFromSeconds from '../../utils/calculateTimeFromSeconds';
import SongArtist from '../SongsPage/SongArtist';

type Props = { albumData: Album; songsData: SongData[] };

const AlbumImgAndInfoContainer = (props: Props) => {
  const { t } = useTranslation();

  const { albumData, songsData } = props;

  const albumDuration = useMemo(
    () =>
      calculateTimeFromSeconds(songsData.reduce((prev, current) => prev + current.duration, 0))
        .timeString,
    [songsData]
  );

  const albumArtistComponents = useMemo(() => {
    const artists = albumData?.artists;
    if (Array.isArray(artists) && artists.length > 0)
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className="!text-lg"
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i) arr.push(<span className="mr-1">,</span>);

          return arr;
        })
        .flat();
    return <span className="text-xs font-normal">{t(`common.unknownArtist`)}</span>;
  }, [albumData?.artists, t]);

  return (
    <>
      {albumData && (
        <HeroHeader
          artwork={albumData.artworkPaths?.artworkPath}
          kind={t('common.album_one')}
          title={albumData.title}
          subtitle={
            albumData.artists && albumData.artists.length > 0 ? (
              <div className="album-artists flex min-w-0 cursor-pointer truncate">{albumArtistComponents}</div>
            ) : undefined
          }
          meta={[
            t('common.songWithCount', { count: albumData.songs?.length ?? 0 }),
            songsData.length > 0 ? albumDuration : undefined,
            albumData.year
          ]}
        />
      )}
    </>
  );
};

export default AlbumImgAndInfoContainer;
