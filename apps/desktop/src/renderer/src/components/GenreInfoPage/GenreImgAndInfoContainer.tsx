import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import calculateTimeFromSeconds from '../../utils/calculateTimeFromSeconds';

import HeroHeader from '../ui/HeroHeader';

type Props = {
  genreData: Genre;
  genreSongs: AudioInfo[];
};

const GenreImgAndInfoContainer = (props: Props) => {
  const { t } = useTranslation();

  const { genreData, genreSongs } = props;

  const totalGenreSongsDuration = useMemo(
    () =>
      calculateTimeFromSeconds(genreSongs.reduce((prev, current) => prev + current.duration, 0))
        .timeString,
    [genreSongs]
  );

  return (
    <>
      {genreData && genreData.genreId && (
        <HeroHeader
          artwork={genreData.artworkPaths.artworkPath}
          kind={t('common.genre_one')}
          title={genreData.name}
          meta={[t('common.songWithCount', { count: genreData.songs.length }), totalGenreSongsDuration]}
        />
      )}
    </>
  );
};

export default GenreImgAndInfoContainer;
