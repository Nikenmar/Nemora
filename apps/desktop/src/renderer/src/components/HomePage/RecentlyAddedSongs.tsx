import { type ForwardedRef, forwardRef, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import SongCard from '../SongsPage/SongCard';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import SecondaryContainer from '../SecondaryContainer';
import Button from '../Button';

type Props = { latestSongs: AudioInfo[]; noOfVisibleSongs: number };

const RecentlyAddedSongs = forwardRef((props: Props, ref: ForwardedRef<HTMLDivElement>) => {
  const { changeCurrentActivePage } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { latestSongs, noOfVisibleSongs = 6 } = props;
  const MAX_SONG_LIMIT = 30;

  const selectAllHandler = useSelectAllHandler(latestSongs, 'songs', 'songId');

  const latestSongComponents = useMemo(
    () =>
      latestSongs.length > 0 && latestSongs[0] !== null
        ? latestSongs
            .filter((_, i) => i < (noOfVisibleSongs || MAX_SONG_LIMIT))
            .map((song, index) => {
              const songData = song as AudioInfo;
              return (
                <SongCard
                  index={index}
                  key={songData.songId}
                  title={songData.title}
                  artworkPath={songData.artworkPaths?.artworkPath || DefaultSongCover}
                  path={songData.path}
                  songId={songData.songId}
                  artists={songData.artists}
                  album={songData.album}
                  palette={songData.paletteData}
                  isAFavorite={songData.isAFavorite}
                  isBlacklisted={songData.isBlacklisted}
                  selectAllHandler={selectAllHandler}
                />
              );
            })
        : [],
    [latestSongs, noOfVisibleSongs, selectAllHandler]
  );

  return (
    <SecondaryContainer
      className="recently-added-songs-container appear-from-bottom h-fit max-h-full w-full flex-col pb-8"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
      ref={ref}
    >
      {latestSongs.length > 0 && latestSongs[0] !== null && (
        <>
          <div className="title-container mb-3 flex items-center justify-between pr-4 text-title font-semibold text-ink">
            {t('homePage.recentlyAddedSongs')}
            <Button
              label={t('common.showAll')}
              tooltipLabel={t('homePage.openSongsWithNewestSortOption')}
              variant="ghost"
              size="sm"
              className="show-all-btn !mr-0"
              clickHandler={() =>
                changeCurrentActivePage('Songs', {
                  sortingOrder: 'dateAddedAscending'
                })
              }
            />
          </div>
          <div
            style={{
              gridTemplateColumns: `repeat(${noOfVisibleSongs},minmax(0,1fr))`
            }}
            className="songs-container grid max-w-full gap-x-5 pr-4"
          >
            {latestSongComponents}
          </div>
        </>
      )}
    </SecondaryContainer>
  );
});

RecentlyAddedSongs.displayName = 'RecentlyAddedSongs';
export default RecentlyAddedSongs;
