/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Img from '../Img';
import Button from '../Button';

export interface MostRelevantResultProp {
  resultType: 'artist' | 'song' | 'album' | 'playlist' | 'genre';
  title: string;
  id: string;
  infoType1?: string;
  infoType2?: string;
  artworkPaths: ArtworkPaths;
  onlineArtworkPath?: string;
  contextMenuItems: ContextMenuItem[];
}

export const MostRelevantResult = (props: MostRelevantResultProp) => {
  const { playSong, updateContextMenuData, changeCurrentActivePage } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const {
    id,
    title,
    infoType1,
    infoType2,
    resultType,
    artworkPaths,
    contextMenuItems,
    onlineArtworkPath
  } = props;

  const goToSongInfoPage = useCallback(
    (songId: string) =>
      changeCurrentActivePage('SongInfo', {
        songId
      }),
    [changeCurrentActivePage]
  );

  const goToArtistInfoPage = useCallback(
    (artistName: string, artistId: string) =>
      changeCurrentActivePage('ArtistInfo', {
        artistName,
        artistId
      }),
    [changeCurrentActivePage]
  );

  const goToAlbumInfoPage = useCallback(
    (albumId: string) =>
      changeCurrentActivePage('AlbumInfo', {
        albumId
      }),
    [changeCurrentActivePage]
  );

  const goToGenreInfoPage = useCallback(
    (genreId: string) =>
      changeCurrentActivePage('GenreInfo', {
        genreId
      }),
    [changeCurrentActivePage]
  );

  return (
    <div
      className={`result appear-from-bottom group most-relevant-${resultType.toLowerCase()} active mr-4 grid h-40 w-fit min-w-[20rem] max-w-md cursor-pointer grid-cols-[10rem_1fr] items-center rounded-lg bg-surface-2 py-3 pl-3 pr-4 hover:bg-accent `}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY);
      }}
      onClick={() => {
        if (resultType === 'song') return goToSongInfoPage(id);
        if (resultType === 'artist') return goToArtistInfoPage(title, id);
        if (resultType === 'album') return goToAlbumInfoPage(id);
        if (resultType === 'genre') return goToGenreInfoPage(id);

        return undefined;
      }}
    >
      <div className="result-img-container relative mr-4 flex h-full w-fit items-center justify-center overflow-hidden">
        {resultType.toLowerCase() !== 'artist' && (
          <Button
            className="absolute z-10 !m-0 !rounded-none !border-0 !p-0 opacity-75 outline-1 outline-offset-1 transition-opacity hover:opacity-100 focus-visible:!outline group-hover:opacity-100"
            iconName="play_circle"
            iconClassName="!text-4xl !leading-none text-on-media"
            clickHandler={(e) => {
              e.stopPropagation();
              playSong(id);
            }}
          />
        )}
        <Img
          src={onlineArtworkPath}
          fallbackSrc={artworkPaths.artworkPath}
          alt="Most Relevant Result Cover"
          className={`max-h-full ${resultType === 'artist' ? 'rounded-full' : 'rounded-md'}`}
        />
      </div>
      <div className="result-info-container max-w-[50%] text-ink group-hover:text-ink ">
        <div className="title overflow-hidden text-ellipsis whitespace-nowrap text-2xl">
          {title}
        </div>
        {infoType1 && (
          <div className="info-type-1 overflow-hidden text-ellipsis whitespace-nowrap text-base">
            {infoType1}
          </div>
        )}
        {infoType2 && (
          <div className="info-type-2 overflow-hidden text-ellipsis whitespace-nowrap text-sm">
            {infoType2}
          </div>
        )}
        <div className="result-type mt-3 w-fit -translate-x-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-2xl bg-accent px-3 py-1 font-medium uppercase text-on-accent group-hover:bg-canvas group-hover:text-ink ">
          {t(`common.${resultType}_one`)}
        </div>
      </div>
    </div>
  );
};
