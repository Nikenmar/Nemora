import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import SecondaryContainer from '../SecondaryContainer';
import SongCard from '../SongsPage/SongCard';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import Button from '../Button';

type Props = { mostLovedSongs: AudioInfo[]; noOfVisibleSongs: number };

const MostLovedSongs = (props: Props) => {
  const { changeCurrentActivePage } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { mostLovedSongs, noOfVisibleSongs = 3 } = props;
  const MAX_SONG_LIMIT = 15;

  const selectAllHandler = useSelectAllHandler(mostLovedSongs, 'songs', 'songId');
  const mostLovedSongComponents = useMemo(
    () =>
      mostLovedSongs
        .filter((_, i) => i < (noOfVisibleSongs || MAX_SONG_LIMIT))
        .map((song, index) => {
          return (
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
              selectAllHandler={selectAllHandler}
            />
          );
        }),
    [mostLovedSongs, noOfVisibleSongs, selectAllHandler]
  );

  return (
    <>
      {mostLovedSongComponents.length > 0 && (
        <SecondaryContainer
          className="recently-played-songs-container appear-from-bottom flex h-fit max-h-full flex-col pb-8"
          focusable
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'a') {
              e.stopPropagation();
              selectAllHandler();
            }
          }}
        >
          <>
            <div className="title-container mb-3 flex items-center justify-between pr-4 text-title font-semibold text-ink">
              {t('homePage.mostLovedSongs')}
              <Button
                label={t('common.showAll')}
                tooltipLabel={t('homePage.openFavoritesWithAllTimeMostListenedSortOption')}
                variant="ghost"
                size="sm"
                className="show-all-btn !mr-0"
                clickHandler={() =>
                  changeCurrentActivePage('PlaylistInfo', {
                    playlistId: 'Favorites',
                    sortingOrder: 'allTimeMostListened'
                  })
                }
              />
            </div>
            <div
              style={{
                gridTemplateColumns: `repeat(${noOfVisibleSongs},minmax(0,1fr))`
              }}
              className="songs-container grid gap-x-5 pr-4"
            >
              {mostLovedSongComponents}
            </div>
          </>
        </SecondaryContainer>
      )}
    </>
  );
};

export default MostLovedSongs;
