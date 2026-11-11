 

/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import SoundTag from '../ui/SoundTag';
import { versionTag } from '../../other/soundTag';
import { songOf, songSoundStore } from '../../other/songSound';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';

import { type DraggableProvided } from '@hello-pangea/dnd';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';

import { versionMenuItems } from '../../other/versionMenu';
const AddSongsToPlaylistsPrompt = lazy(() => import('./AddSongsToPlaylistsPrompt'));
const WhyThisSongPrompt = lazy(() => import('../WhyThisSongPrompt'));
const BlacklistSongConfrimPrompt = lazy(() => import('./BlacklistSongConfirmPrompt'));
const DeleteSongsFromSystemConfrimPrompt = lazy(
  () => import('./DeleteSongsFromSystemConfrimPrompt')
);

import SongArtist from './SongArtist';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';

import { appPreferences } from '../../../../../package.json';
import EqualizerBars from '../ui/EqualizerBars';
import ShuffleReason from '../ui/ShuffleReason';
import { steer, type SteeringAction } from '../../other/smartShuffle';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { flyToQueue } from '../../other/motion';

interface SongProp {
  songId: string;
  artworkPaths: ArtworkPaths;
  title: string;
  artists?: { name: string; artistId: string }[];
  album?: { name: string; albumId: string };
  duration: number;
  year?: number;
  path: string;
  isBlacklisted?: boolean;
  additionalContextMenuItems?: ContextMenuItem[];
  index: number;
  trackNo?: number | string;
  isIndexingSongs: boolean;
  isAFavorite: boolean;
  className?: string;
  onPlayClick?: (currSongId: string) => void;
  style?: CSSProperties;
  isDraggable?: boolean;
  provided?: DraggableProvided;
  selectAllHandler?: (_upToId?: string) => void;
  /** The queue shows Smart Shuffle's reason for an upcoming song beside its artists (PLAN/14 C1). */
  isShuffleReasonShown?: boolean;
  /** A version's row (PLAN/18 D6): the tag beside the title. */
  version?: SongVersion | null;
}

const Song = forwardRef((props: SongProp, ref: ForwardedRef<HTMLDivElement>) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  // On its own: toggleIsFavorite sets the flag on the current object before dispatching a copy, and
  // the store compares selections shallowly, so the whole object never shows the change.
  const isCurrentSongAFavorite = useStore(store, (state) => state.currentSongData.isAFavorite);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const localStorageData = useStore(store, (state) => state.localStorage);
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  // Steering actions (PLAN/14 C2) while Smart Shuffle is on and the user has not hidden them.
  const isSteeringShown = useStore(
    store,
    (state) =>
      state.player.isTierShuffling && !state.localStorage.preferences.isShuffleSteeringHidden
  );

  const {
    playSong,
    updateContextMenuData,
    changeCurrentActivePage,
    updateQueueData,
    changePromptMenuData,
    addNewNotifications,
    toggleIsFavorite,
    toggleMultipleSelections,
    updateMultipleSelections,
    createQueue
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const {
    index,
    songId,
    duration,
    artworkPaths,
    isIndexingSongs,
    isBlacklisted = false,
    path,
    title,
    additionalContextMenuItems,
    artists,
    album,
    style,
    year,
    trackNo,
    selectAllHandler,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provided = {} as any,
    onPlayClick,
    isShuffleReasonShown = false,
    version
  } = props;
  // Switch version: the song itself sounds like a version (other/songSound.ts).
  const ownSound = useStore(songSoundStore, (all) => (version ? undefined : all[songOf(songId)]));

  const [isAFavorite, setIsAFavorite] = useState(props.isAFavorite);
  const [heartPop, setHeartPop] = useState(0);
  const wasFavorite = useRef(props.isAFavorite);
  useEffect(() => {
    if (isAFavorite && !wasFavorite.current) setHeartPop((n) => n + 1);
    wasFavorite.current = isAFavorite;
  }, [isAFavorite]);
  const [isSongPlaying, setIsSongPlaying] = useState(false);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setIsSongPlaying(() => currentSongData?.songId === songId && isCurrentSongPlaying);
    setIsAFavorite((prevState) => {
      if (currentSongData?.songId === songId) return isCurrentSongAFavorite;
      return prevState;
    });
  }, [currentSongData.songId, isCurrentSongAFavorite, isCurrentSongPlaying, songId]);

  const handlePlayBtnClick = useCallback(() => {
    if (onPlayClick) return onPlayClick(songId);
    return playSong(songId);
  }, [onPlayClick, playSong, songId]);

  const handleLikeButtonClick = useCallback(() => {
    window.api.playerControls
      .toggleLikeSongs([songId], !isAFavorite)
      .then((res) => {
        if (res && res.likes.length + res.dislikes.length > 0) {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          return setIsAFavorite((prevData) => !prevData);
        }
        setIsAFavorite((prevData) => !prevData);
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [currentSongData.isAFavorite, currentSongData.songId, isAFavorite, songId, toggleIsFavorite]);

  const { minutes, seconds } = useMemo(() => {
    const addZero = (num: number) => {
      if (num < 10) return `0${num}`;
      return num.toString();
    };

    const min = Math.floor((duration || 0) / 60);
    const sec = Math.floor((duration || 0) % 60);

    return {
      minutes: Number.isNaN(min) ? undefined : addZero(min),
      seconds: Number.isNaN(sec) ? undefined : addZero(sec)
    };
  }, [duration]);

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'songs') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === songId))
      return true;
    return false;
  }, [
    multipleSelectionsData.isEnabled,
    multipleSelectionsData.selectionType,
    multipleSelectionsData.multipleSelections,
    songId
  ]);

  const songArtists = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={`${artist.artistId}-${i}`}
              artistId={artist.artistId}
              name={artist.name}
              className={`${
                (currentSongData.songId === songId || isAMultipleSelection) &&
                ''
              }`}
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i)
            arr.push(
              <span key={`${artist.artistId}-${i}-comma`} className="mr-1">
                ,
              </span>
            );

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artists, currentSongData.songId, isAMultipleSelection, songId]);

  const goToSongInfoPage = useCallback(() => {
    if (
      currentlyActivePage.pageTitle !== 'SongInfo' &&
      currentlyActivePage?.data?.songId !== songId
    )
      changeCurrentActivePage('SongInfo', {
        songId
      });
  }, [
    changeCurrentActivePage,
    currentlyActivePage?.data?.songId,
    currentlyActivePage.pageTitle,
    songId
  ]);

  const goToAlbumInfoPage = useCallback(() => {
    if (
      album?.albumId &&
      currentlyActivePage.pageTitle !== 'AlbumInfo' &&
      currentlyActivePage?.data?.albumId !== album.albumId
    )
      changeCurrentActivePage('AlbumInfo', {
        albumId: album.albumId
      });
  }, [
    album?.albumId,
    changeCurrentActivePage,
    currentlyActivePage?.data?.albumId,
    currentlyActivePage.pageTitle
  ]);

  const steerWith = useCallback(
    (action: SteeringAction) => {
      steer(action)
        .then(() =>
          addNewNotifications([
            { id: 'smartShuffleSteered', duration: 4000, content: t('smartShuffle.steeringApplied') }
          ])
        )
        .catch((error) => console.error(error));
    },
    [addNewNotifications, t]
  );

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'songs' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    const { multipleSelections: songIds } = multipleSelectionsData;

    const items: ContextMenuItem[] = [
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: additionalContextMenuItems === undefined
      },
      {
        label: t('common.play'),
        handlerFunction: () => {
          handlePlayBtnClick();
        },
        iconName: 'play_arrow',
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.createAQueue'),
        handlerFunction: () => {
          createQueue(songIds, 'songs', false, undefined, true);
        },
        iconName: 'queue_music',
        isDisabled: !isMultipleSelectionsEnabled
      },
      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playNextAll' : 'playNext'}`),
        iconName: 'shortcut',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            let currentSongIndex =
              queue.currentSongIndex ?? queue.queue.indexOf(currentSongData.songId);
            const duplicateIds: string[] = [];

            const newQueue = queue.queue.filter((id) => {
              const isADuplicate = songIds.includes(id);
              if (isADuplicate) duplicateIds.push(id);

              return !isADuplicate;
            });

            for (const duplicateId of duplicateIds) {
              const duplicateIdPosition = queue.queue.indexOf(duplicateId);

              if (
                duplicateIdPosition !== -1 &&
                duplicateIdPosition < currentSongIndex &&
                currentSongIndex - 1 >= 0
              )
                currentSongIndex -= 1;
            }
            newQueue.splice(currentSongIndex + 1, 0, ...songIds);
            updateQueueData(currentSongIndex, newQueue, undefined, false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNextSongsWithCount', {
                  count: songIds.length
                }),
                iconName: 'shortcut'
              }
            ]);
          } else {
            const newQueue = queue.queue.filter((id) => id !== songId);
            const duplicateSongIndex = queue.queue.indexOf(songId);

            const currentSongIndex =
              queue.currentSongIndex &&
              duplicateSongIndex !== -1 &&
              duplicateSongIndex < queue.currentSongIndex
                ? queue.currentSongIndex - 1
                : undefined;

            newQueue.splice(newQueue.indexOf(currentSongData.songId) + 1 || 0, 0, songId);
            updateQueueData(currentSongIndex, newQueue, undefined, false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNext', { title }),
                iconName: 'shortcut'
              }
            ]);
          }
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            updateQueueData(undefined, [...queue.queue, ...songIds], false);
            addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                content: t('notifications.addedToQueue', {
                  count: songIds.length
                }),
                iconName: 'add'
              }
            ]);
          } else {
            updateQueueData(undefined, [...queue.queue, songId], false);
            flyToQueue();
            addNewNotifications([
              {
                id: `${title}AddedToQueue`,
                content: t('notifications.addedToQueue', {
                  count: 1
                }),
                icon: (
                  <Img
                    src={artworkPaths?.optimizedArtworkPath || DefaultSongCover}
                    loading="lazy"
                    alt="Song Artwork"
                  />
                )
              }
            ]);
          }
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t('song.toggleLikeSongs')
          : t(`song.${isAFavorite ? 'unlikeSong' : 'likeSong'}`),
        iconName: `favorite`,
        iconClassName: isMultipleSelectionsEnabled
          ? 'ms-icon mr-4 text-xl'
          : isAFavorite
            ? 'ms-icon ms-icon-filled mr-4 text-xl'
            : 'ms-icon mr-4 text-xl',
        handlerFunction: () => {
          window.api.playerControls
            .toggleLikeSongs(isMultipleSelectionsEnabled ? [...songIds] : [songId])
            .then((res) => {
              if (res && res.likes.length + res.dislikes.length > 0) {
                if (currentSongData.songId === songId)
                  toggleIsFavorite(!currentSongData.isAFavorite);
                return setIsAFavorite((prevData) => !prevData);
              }
              return undefined;
            })
            .catch((err) => console.error(err));
        }
      },
      {
        label: t('song.addToPlaylists'),
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt
              songIds={isAMultipleSelection ? songIds : [songId]}
              title={title}
            />
          );
        }
      },
      // Versions (PLAN/18 D6), for one song at a time.
      ...(isAMultipleSelection ? [] : versionMenuItems(songId, title, t, changePromptMenuData, addNewNotifications, version)),
      // Why this song? (PLAN/14 C1) wherever Smart Shuffle's reason shows under the song.
      ...(isShuffleReasonShown && !isAMultipleSelection
        ? [
            {
              label: t('smartShuffle.whyThisSong'),
              iconName: 'auto_fix',
              handlerFunction: () =>
                changePromptMenuData(true, <WhyThisSongPrompt songId={songId} title={title} />, '!max-w-[34rem]')
            }
          ]
        : []),
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
          } else toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        }
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !selectAllHandler,
      //   handlerFunction: () => selectAllHandler && selectAllHandler(),
      // },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.dragOutFile'),
        class: 'drag-out-file',
        iconName: 'drag_indicator',
        // Nothing happens on click: this item is a handle, and the gesture is
        // the whole feature. Closing the menu is all a click should do.
        handlerFunction: () => undefined,
        fileDrag: { paths: [path], artwork: artworkPaths?.artworkPath },
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.info'),
        class: 'info',
        iconName: 'info',
        iconClassName: 'ms-icon',
        handlerFunction: goToSongInfoPage,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.goToAlbum'),
        iconName: 'album',
        handlerFunction: () =>
          album &&
          changeCurrentActivePage('AlbumInfo', {
            albumId: album?.albumId
          }),
        isDisabled: !album
      },
      {
        label: t('song.editSongTags'),
        class: 'edit',
        iconName: 'edit',
        handlerFunction: () =>
          changeCurrentActivePage('SongTagsEditor', {
            songId,
            songArtworkPath: artworkPaths.artworkPath,
            songPath: path
          }),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.reparseSong'),
        class: 'sync',
        iconName: 'sync',
        handlerFunction: () => window.api.songUpdates.reParseSong(path),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
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
          else if (localStorageData?.preferences.doNotShowBlacklistSongConfirm)
            window.api.audioLibraryControls
              .blacklistSongs([songId])
              .then(() =>
                addNewNotifications([
                  {
                    id: `${title}Blacklisted`,
                    duration: 5000,
                    content: t('notifications.songBlacklisted', { title }),
                    iconName: 'block'
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
        },
        isDisabled: isMultipleSelectionsEnabled
      },
      ...(isSteeringShown
        ? [
            { label: 'Hr', isContextMenuItemSeperator: true, handlerFunction: () => true },
            ...(artists?.[0]
              ? [
                  {
                    label: t('smartShuffle.lessArtist', { artist: artists[0].name }),
                    iconName: 'trending_down',
                    handlerFunction: () => steerWith({ kind: 'lessArtist', artist: artists[0].name }),
                    isDisabled: isMultipleSelectionsEnabled
                  }
                ]
              : []),
            {
              label: t('smartShuffle.moreLike'),
              iconName: 'trending_up',
              handlerFunction: () => steerWith({ kind: 'moreLike', songId, title }),
              isDisabled: isMultipleSelectionsEnabled
            },
            {
              label: t('smartShuffle.notNow'),
              iconName: 'schedule',
              handlerFunction: () => steerWith({ kind: 'notNow', songId, title }),
              isDisabled: isMultipleSelectionsEnabled || currentSongData.songId === songId
            }
          ]
        : []),
      {
        label: t('song.delete'),
        iconName: 'delete',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <DeleteSongsFromSystemConfrimPrompt
              songIds={isMultipleSelectionsEnabled ? songIds : [songId]}
            />
          );
          toggleMultipleSelections(false);
        }
      }
    ];

    if (additionalContextMenuItems) items.unshift(...additionalContextMenuItems);

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownSound rebuilds the menu when Switch version changes the sound the menu reads
  }, [
    ownSound,
    artists,
    version,
    multipleSelectionsData,
    isAMultipleSelection,
    additionalContextMenuItems,
    isSteeringShown,
    steerWith,
    t,
    isAFavorite,
    goToSongInfoPage,
    album,
    isBlacklisted,
    handlePlayBtnClick,
    toggleMultipleSelections,
    createQueue,
    queue.currentSongIndex,
    queue.queue,
    currentSongData.songId,
    currentSongData.isAFavorite,
    updateQueueData,
    addNewNotifications,
    title,
    songId,
    artworkPaths?.optimizedArtworkPath,
    artworkPaths.artworkPath,
    toggleIsFavorite,
    changePromptMenuData,
    isMultipleSelectionEnabled,
    updateMultipleSelections,
    changeCurrentActivePage,
    path,
    localStorageData?.preferences.doNotShowBlacklistSongConfirm,
    isShuffleReasonShown
  ]);

  const contextMenuItemData: ContextMenuAdditionalData =
    isMultipleSelectionEnabled &&
    multipleSelectionsData.selectionType === 'songs' &&
    isAMultipleSelection
      ? {
          title: t('song.selectedSongCount', {
            count: multipleSelectionsData.multipleSelections.length
          }),
          artworkPath: DefaultSongCover
        }
      : {
          title: title || t('common.unknownTitle'),
          subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
          artworkPath: artworkPaths?.optimizedArtworkPath || DefaultSongCover
        };

  const isCurrent = currentSongData.songId === songId;
  const isSelectable = isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs';
  const showIndex = isIndexingSongs || (trackNo && localStorageData.preferences.showTrackNumberAsSongIndex);

  return (
    <div
      style={style}
      data-index={index}
      data-shot="song-row"
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      className={`${songId} group relative mb-0.5 mr-3 flex h-[50px] items-center gap-3.5 rounded-lg px-2.5 outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-echo ${
        isAMultipleSelection
          ? 'bg-accent-soft'
          : bodyBackgroundImage
            ? 'hover:bg-surface-2/70 hover:backdrop-blur-md'
            : 'hover:bg-surface-2'
      } ${!isAMultipleSelection && isBlacklisted && 'opacity-40'}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        clickTimeoutRef.current = setTimeout(() => {
          if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(songId);
          else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
            toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
          else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs')
            updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
        }, 100);
      }}
      onDoubleClick={() => {
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        handlePlayBtnClick();
      }}
      ref={ref}
    >
      {isSelectable ? (
        <div className="flex w-6 shrink-0 items-center justify-center">
          <MultipleSelectionCheckbox id={songId} selectionType="songs" />
        </div>
      ) : isBlacklisted ? (
        <span
          className="ms-icon w-6 shrink-0 text-center text-[18px] text-ink-dim"
          title={t('notifications.songBlacklisted', { title })}
        >
          block
        </span>
      ) : showIndex ? (
        <span className="w-7 shrink-0 text-right text-small tabular-nums text-ink-dim">
          {trackNo ?? index + 1}
        </span>
      ) : null}
      <div className="song-cover-and-play-btn-container relative h-[38px] w-[38px] shrink-0 overflow-hidden rounded-cover-sm">
        <Img
          src={artworkPaths?.optimizedArtworkPath || DefaultSongCover}
          loading="eager"
          alt=""
          className="h-full w-full object-cover"
          enableImgFadeIns={false}
        />
        <button
          type="button"
          className={`absolute inset-0 flex items-center justify-center bg-shade/45 text-on-media outline-none transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 ${
            isSongPlaying ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label={isSongPlaying ? t('player.pause', 'Pause') : t('player.play', 'Play')}
          onClick={(e) => {
            e.stopPropagation();
            handlePlayBtnClick();
          }}
        >
          <span className="ms-icon ms-icon-filled text-[22px]">{isSongPlaying ? 'pause' : 'play_arrow'}</span>
        </button>
      </div>
      <div className="song-info-container grid min-w-0 flex-1 grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_2.75rem_1.75rem_3rem] items-center gap-4 lg:grid-cols-[minmax(0,1fr)_1.75rem_3rem] sm:grid-cols-[minmax(0,1fr)_3rem]">
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <div
            className={`song-title flex min-w-0 items-center gap-1.5 text-body font-medium outline-none transition-colors duration-m2 focus-visible:underline ${
              isCurrent ? 'text-echo' : 'text-ink'
            }`}
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && goToSongInfoPage()}
            title={title}
          >
            {isCurrent && <EqualizerBars isPlaying={isSongPlaying} className="mr-0.5" />}
            <span className="truncate">{title}</span>
            <SoundTag tag={version ? versionTag(version) : ownSound ? versionTag(ownSound) : null} className="!-ml-0.5 text-[12.75px]" />
          </div>
          <div className="song-artists min-w-0 truncate text-small text-ink-dim">
            {songArtists}
            {isShuffleReasonShown && (
              <>
                <span className="text-ink-faint"> · </span>
                <ShuffleReason songId={songId} title={title} />
              </>
            )}
          </div>
        </div>
        <div className="song-album min-w-0 truncate text-small text-ink-dim lg:hidden">
          {album?.name ? (
            <span
              className="cursor-pointer outline-none hover:text-ink hover:underline focus-visible:underline"
              tabIndex={0}
              title={album.name}
              role="button"
              onClick={goToAlbumInfoPage}
              onKeyDown={(e) => e.key === 'Enter' && goToAlbumInfoPage()}
            >
              {album.name}
            </span>
          ) : (
            t('common.unknownAlbum')
          )}
        </div>
        <div className="song-year text-right text-small tabular-nums text-ink-faint lg:hidden">
          {window.api.properties.isInDevelopment && appPreferences.showSongIdInsteadOfSongYear
            ? songId
            : (year ?? '')}
        </div>
        <button
          type="button"
          className={`flex h-7 w-7 items-center justify-center rounded-full outline-none transition-[opacity,color] duration-150 hover:bg-line/60 focus-visible:opacity-100 sm:hidden ${
            isAFavorite ? 'text-echo' : 'text-ink-dim opacity-0 group-hover:opacity-100'
          }`}
          data-tooltip={t(`song.${isAFavorite ? 'likedThisSong' : 'dislikedThisSong'}`)}
          aria-label={t(`song.${isAFavorite ? 'likedThisSong' : 'dislikedThisSong'}`)}
          aria-pressed={isAFavorite}
          onClick={(e) => {
            e.stopPropagation();
            handleLikeButtonClick();
          }}
        >
          <span
            key={heartPop}
            className={`ms-icon text-[17px] ${isAFavorite ? 'ms-icon-filled' : ''} ${heartPop ? 'like-pop' : ''}`}
          >
            favorite
          </span>
        </button>
        <span className="song-duration text-right text-small tabular-nums text-ink-dim">
          {minutes ?? '--'}:{seconds ?? '--'}
        </span>
      </div>
    </div>
  );
});

Song.displayName = 'Song';
export default Song;
