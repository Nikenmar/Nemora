 
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { versionMenuItems } from '../../other/versionMenu';
import SoundTag from '../ui/SoundTag';
import { usePlayingTag } from '../../other/soundTag';
import { lazy, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTrackChangeMotion } from '../../other/motion';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import Img from '../Img';
import SongArtist from '../SongsPage/SongArtist';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import UpNextSongPopup from './UpNextSongPopup';
import { useStore } from '@tanstack/react-store';
import { store, selectPreferences } from '@renderer/store';

const AddSongsToPlaylistsPrompt = lazy(() => import('../SongsPage/AddSongsToPlaylistsPrompt'));
const BlacklistSongConfrimPrompt = lazy(() => import('../SongsPage/BlacklistSongConfirmPrompt'));
const DeleteSongsFromSystemConfrimPrompt = lazy(
  () => import('../SongsPage/DeleteSongsFromSystemConfrimPrompt')
);

const CurrentlyPlayingSongInfoContainer = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const playingTag = usePlayingTag();
  const coverRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  useTrackChangeMotion(coverRef, textRef);
  // On its own: toggleIsFavorite sets the flag on the current object before dispatching a copy, and
  // the store compares selections shallowly, so a selection of the whole object never sees it change.
  const isAFavorite = useStore(store, (state) => state.currentSongData.isAFavorite);
  const preferences = useStore(store, selectPreferences('doNotShowBlacklistSongConfirm', 'showArtistArtworkNearSongControls'));

  const {
    changeCurrentActivePage,
    updateContextMenuData,
    changePromptMenuData,
    toggleMultipleSelections,
    addNewNotifications,
    toggleIsFavorite
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [isNextSongPopupVisible, setIsNextSongPopupVisible] = useState(false);

  const songArtistsImages = useMemo(() => {
    if (
      currentSongData.songId &&
      Array.isArray(currentSongData.artists) &&
      currentSongData.artists.length > 0
    )
      return currentSongData.artists
        .filter((artist, index) => artist.onlineArtworkPaths && index < 2)
        .map((artist, index) => (
          <Img
            key={artist.artistId}
            src={artist.onlineArtworkPaths?.picture_small}
            fallbackSrc={artist.artworkPath}
            loading="eager"
            className={`absolute aspect-square w-6 rounded-full border-2 border-canvas ${
              index === 0 ? 'z-2' : '-translate-x-2'
            }`}
            onClick={() => {
              changeCurrentActivePage('ArtistInfo', {
                artistName: artist.name,
                artistId: artist.artistId
              });
            }}
            alt=""
          />
        ));
    return undefined;
  }, [changeCurrentActivePage, currentSongData.artists, currentSongData.songId]);

  const showSongInfoPage = useCallback(
    (songId: string) =>
      currentSongData.isKnownSource
        ? changeCurrentActivePage('SongInfo', {
            songId
          })
        : undefined,
    [changeCurrentActivePage, currentSongData.isKnownSource]
  );

  const gotToSongAlbumPage = useCallback(
    () =>
      currentSongData.isKnownSource && currentSongData.album
        ? changeCurrentActivePage('AlbumInfo', {
            albumId: currentSongData.album.albumId
          })
        : undefined,
    [changeCurrentActivePage, currentSongData.album, currentSongData.isKnownSource]
  );

  const songArtists = useMemo(() => {
    const { songId, artists, isKnownSource } = currentSongData;

    if (songId && Array.isArray(artists)) {
      if (artists.length > 0) {
        return artists
          .map((artist, i, artistArr) => {
            const arr = [
              <SongArtist
                key={artist.artistId}
                artistId={artist.artistId}
                name={artist.name}
                isFromKnownSource={isKnownSource}
              />
            ];

            if ((artists.length ?? 1) - 1 !== i)
              arr.push(
                <span key={`${artistArr[i].name},${artistArr[i + 1].name}`} className="mr-1">
                  ,
                </span>
              );

            return arr;
          })
          .flat();
      }
      return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
    }
    return '';
  }, [currentSongData, t]);

  const contextMenuCurrentSongData = useMemo((): ContextMenuAdditionalData => {
    const { title, artworkPath, artists, album } = currentSongData;
    return {
      title,
      artworkPath: artworkPath ?? DefaultSongCover,
      subTitle: artists?.map((artist) => artist.name).join(', ') || t('common.unknownArtist'),
      subTitle2: album?.name
    };
  }, [currentSongData, t]);

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const { title, songId, album, artworkPath, isBlacklisted, isKnownSource, path } =
      currentSongData;

    return [
      // Make version and Switch version, as in a song's own menu (PLAN/18).
      ...(isKnownSource
        ? versionMenuItems(songId, title, t, changePromptMenuData, addNewNotifications, currentSongData.version)
        : []),
      {
        label: t('song.addToPlaylists'),
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt songIds={[songId]} title={title} />
          );
        }
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId)
      },
      {
        label: t('song.dragOutFile'),
        class: 'drag-out-file',
        iconName: 'drag_indicator',
        handlerFunction: () => undefined,
        fileDrag: { paths: [path], artwork: artworkPath }
      },
      {
        label: t('common.info'),
        iconName: 'info',
        handlerFunction: () => showSongInfoPage(songId),
        isDisabled: !isKnownSource
      },
      {
        label: t('song.goToAlbum'),
        iconName: 'album',
        handlerFunction: gotToSongAlbumPage,
        isDisabled: !isKnownSource || !album
      },
      {
        label: t('song.editSongTags'),
        class: 'edit',
        iconName: 'edit',
        handlerFunction: () =>
          changeCurrentActivePage('SongTagsEditor', {
            songId,
            songArtworkPath: artworkPath,
            // The player plays a media URL; the tag editor reads and writes the file itself.
            songPath: window.api.utils.localPathFromAssetUrl(path),
            isKnownSource
          })
      },
      {
        label: t('common.saveArtwork'),
        class: 'edit',
        iconName: 'image',
        iconClassName: 'ms-icon',
        handlerFunction: () =>
          artworkPath &&
          window.api.songUpdates.saveArtworkToSystem(
            artworkPath,
            `${title} song artwork`.replaceAll(' ', '_')
          ),
        isDisabled: currentSongData.artworkPath === undefined
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true
      },
      {
        label: t(`song.${isBlacklisted ? 'deblacklist' : 'blacklistSong'}`, {
          count: 1
        }),
        iconName: isBlacklisted ? 'settings_backup_restore' : 'block',
        handlerFunction: () => {
          if (isBlacklisted)
            window.api.audioLibraryControls
              .restoreBlacklistedSongs([songId])
              .catch((err) => console.error(err));
          else if (preferences?.doNotShowBlacklistSongConfirm)
            window.api.audioLibraryControls
              .blacklistSongs([songId])
              .then(() =>
                addNewNotifications([
                  {
                    id: `${title}Blacklisted`,
                    duration: 5000,
                    content: t('notifications.songBlacklisted', { title }),
                    icon: <span className="ms-icon">block</span>
                  }
                ])
              )
              .catch((err) => console.error(err));
          else
            changePromptMenuData(
              true,
              <BlacklistSongConfrimPrompt title={title} songIds={[songId]} />
            );
          return toggleMultipleSelections(false);
        }
      },
      {
        label: t('song.delete'),
        iconName: 'delete',
        handlerFunction: () => {
          changePromptMenuData(true, <DeleteSongsFromSystemConfrimPrompt songIds={[songId]} />);
          toggleMultipleSelections(false);
        }
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playingTag rebuilds the menu when Switch version changes the sound the menu reads
  }, [
    playingTag,
    addNewNotifications,
    changeCurrentActivePage,
    changePromptMenuData,
    currentSongData,
    gotToSongAlbumPage,
    preferences?.doNotShowBlacklistSongConfirm,
    showSongInfoPage,
    t,
    toggleMultipleSelections
  ]);

  return (
    <div className="current-playing-song-info-container flex min-w-0 items-center gap-3 pl-4">
      <div
        className="song-cover-container player-cover relative h-12 w-12 shrink-0 lg:hidden"
        id="currentSongCover"
        ref={coverRef}
      >
        {/* ${
               !currentSongData.artworkPath &&
               `before:absolute before:h-[85%] before:w-[85%] before:rounded-md before:bg-surface-2 before:bg-surface-2 before:content-[''] after:absolute after:h-5 after:w-5 after:animate-spin-ease after:rounded-full after:border-2 after:border-[transparent] after:border-t-ink after:content-['']`
             } */}
        <Img
          className="h-12 w-12 rounded-cover-sm object-cover object-center shadow-[0_4px_14px_rgb(0_0_0/0.35)]"
          src={currentSongData.artworkPath}
          fallbackSrc={DefaultSongCover}
          alt="Default song cover"
          onContextMenu={(e) => {
            e.stopPropagation();
            updateContextMenuData(
              true,
              contextMenuItems,
              e.pageX,
              e.pageY,
              contextMenuCurrentSongData
            );
          }}
        />
      </div>
      {/* As wide as its text, so the heart sits right after the title instead of at the far edge. */}
      <div
        ref={textRef}
        className="song-info-container relative flex min-w-0 shrink flex-col items-start justify-center gap-0.5"
      >
        {currentSongData.title && (
          <div className="song-title flex w-full items-center">
            <div
              className={`w-fit min-w-0 cursor-pointer truncate text-[14px] font-semibold leading-5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-echo ${
                currentSongData.isKnownSource && 'hover:underline'
              }`}
              id="currentSongTitle"
              title={currentSongData.title}
              onClick={() => showSongInfoPage(currentSongData.songId)}
              onKeyDown={(e) => e.key === 'Enter' && showSongInfoPage(currentSongData.songId)}
              onContextMenu={(e) => {
                e.stopPropagation();
                updateContextMenuData(
                  true,
                  contextMenuItems,
                  e.pageX,
                  e.pageY,
                  contextMenuCurrentSongData
                );
              }}
              tabIndex={0}
            >
              {currentSongData.title}
            </div>
            {/* How it sounds now (a version, a preset or a speed set by hand), beside the title. */}
            <SoundTag tag={playingTag} className="text-[13px] leading-5" />
            {!currentSongData.isKnownSource && (
              <span
                className="ms-icon ml-1.5 cursor-help text-[16px] text-warning"
                title="You are playing from an unknown source. Some features are disabled."
              >
                error
              </span>
            )}
          </div>
        )}
        {!isNextSongPopupVisible && (
          <div
            className="song-artists appear-from-bottom flex w-full items-center truncate"
            id="currentSongArtists"
          >
            {preferences?.showArtistArtworkNearSongControls &&
              songArtistsImages &&
              songArtistsImages.length > 0 && (
                <span
                  className={`relative mr-2 flex h-6 items-center lg:hidden ${
                    songArtistsImages.length === 1 ? 'w-6' : 'w-10'
                  } `}
                >
                  {songArtistsImages}
                </span>
              )}
            <span className="flex min-w-0 truncate text-small text-ink-dim">
              {songArtists}
            </span>
          </div>
        )}
        <UpNextSongPopup onPopupAppears={(isVisible) => setIsNextSongPopupVisible(isVisible)} />
      </div>
      {/* The heart belongs to the song, so it sits with it; the centre keeps three controls a side. */}
      {currentSongData.title && (
        <Button
          className={`like-btn !m-0 !h-8 !w-8 shrink-0 ${
            isAFavorite ? '!text-echo hover:!text-echo' : ''
          } ${!currentSongData.isKnownSource && '!cursor-not-allowed opacity-40'}`}
          tooltipLabel={
            currentSongData.isKnownSource ? t('player.likeDislike') : t('player.likeDislikeDisabled')
          }
          iconName="favorite"
          isActive={isAFavorite}
          clickHandler={() => currentSongData.isKnownSource && toggleIsFavorite(!isAFavorite)}
        />
      )}
    </div>
  );
};

export default CurrentlyPlayingSongInfoContainer;
