/* eslint-disable promise/catch-or-return */
import TitleContainer from "../TitleContainer";
import EmptyState from "../ui/EmptyState";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  Draggable,
  Droppable,
  DragDropContext,
  type DropResult,
} from "@hello-pangea/dnd";
import { AppUpdateContext } from "../../contexts/AppUpdateContext";
import useSelectAllHandler from "../../hooks/useSelectAllHandler";
import calculateTimeFromSeconds from "../../utils/calculateTimeFromSeconds";

import DefaultSongCover from "../../assets/images/webp/song_cover_default.webp";
import DefaultPlaylistCover from "../../assets/images/webp/playlist_cover_default.webp";
import FolderImg from "../../assets/images/webp/empty-folder.webp";
import MainContainer from "../MainContainer";
import Img from "../Img";
import Song from "../SongsPage/Song";
import SteeringBar from "./SteeringBar";
import { useShuffleReasonsShown } from "../ui/ShuffleReason";
import VirtualizedList from "../VirtualizedList";
import { type VirtuosoHandle } from "react-virtuoso";
import { useStore } from "@tanstack/react-store";
import { store } from "@renderer/store";

interface QueueInfo {
  artworkPath: string;
  onlineArtworkPath?: string;
  title: string;
}

const CurrentQueuePage = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled,
  );
  const multipleSelectionsData = useStore(
    store,
    (state) => state.multipleSelectionsData,
  );
  const currentlyActivePage = useStore(
    store,
    (state) => state.currentlyActivePage,
  );
  const queue = useStore(store, (state) => state.localStorage.queue);
  const currentQueue = useStore(
    store,
    (state) => state.localStorage.queue.queue,
  );
  const preferences = useStore(
    store,
    (state) => state.localStorage.preferences,
  );
  const isShuffleReasonShown = useShuffleReasonsShown();

  const { updateQueueData, addNewNotifications, toggleMultipleSelections } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [queuedSongs, setQueuedSongs] = useState([] as AudioInfo[]);
  const previousQueueRef = useRef<string[]>([]);
  const [queueInfo, setQueueInfo] = useState({
    artworkPath: DefaultSongCover,
    title: "",
  } as QueueInfo);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);

  const ListRef = useRef<VirtuosoHandle>(null);

  // const isTheSameQueue = useCallback((newQueueSongIds: string[]) => {
  //   const prevQueueSongIds = previousQueueRef.current;
  //   const isSameQueue = prevQueueSongIds.every((id) => newQueueSongIds.includes(id));

  //   return isSameQueue;
  // }, []);

  const fetchAllSongsData = useCallback(() => {
    window.api.audioLibraryControls
      .getSongInfo(currentQueue, "addedOrder", undefined, undefined, true)
      .then((res) => {
        if (res) {
          setQueuedSongs(res);
          previousQueueRef.current = currentQueue.slice();
        }
      });
  }, [currentQueue]);

  useEffect(() => {
    fetchAllSongsData();
    const manageSongUpdatesInCurrentQueue = (e: Event) => {
      if ("detail" in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>)
          .detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (
            event.dataType.includes("songs") ||
            event.dataType === "userData/queue" ||
            event.dataType === "blacklist/songBlacklist" ||
            event.dataType === "songs/likes"
          )
            fetchAllSongsData();
        }
      }
    };
    document.addEventListener(
      "app/dataUpdates",
      manageSongUpdatesInCurrentQueue,
    );
    return () => {
      document.removeEventListener(
        "app/dataUpdates",
        manageSongUpdatesInCurrentQueue,
      );
    };
  }, [fetchAllSongsData]);

  useEffect(() => {
    if (queue.queueType) {
      if (queue.queueType === "songs") {
        setQueueInfo((prevData) => {
          return {
            ...prevData,
            artworkPath: currentSongData.artworkPath || DefaultSongCover,
            title: "All Songs",
          };
        });
      }
      if (queue.queueId) {
        if (queue.queueType === "artist") {
          window.api.artistsData.getArtistData([queue.queueId]).then((res) => {
            if (res && Array.isArray(res) && res[0]) {
              setQueueInfo((prevData) => {
                return {
                  ...prevData,
                  artworkPath: res[0].artworkPaths.artworkPath,
                  onlineArtworkPath: res[0].onlineArtworkPaths
                    ? res[0].onlineArtworkPaths.picture_medium
                    : undefined,
                  title: res[0].name,
                };
              });
            }
          });
        }
        if (queue.queueType === "album") {
          window.api.albumsData.getAlbumData([queue.queueId]).then((res) => {
            if (res && res.length > 0 && res[0]) {
              setQueueInfo((prevData) => {
                return {
                  ...prevData,
                  artworkPath: res[0].artworkPaths.artworkPath,
                  title: res[0].title,
                };
              });
            }
          });
        }
        if (queue.queueType === "playlist") {
          window.api.playlistsData
            .getPlaylistData([queue.queueId])
            .then((res) => {
              if (res && res.length > 0 && res[0]) {
                setQueueInfo((prevData) => {
                  return {
                    ...prevData,
                    artworkPath: res[0].artworkPaths
                      ? res[0].artworkPaths.artworkPath
                      : DefaultPlaylistCover,
                    title: res[0].name,
                  };
                });
              }
            });
        }
        if (queue.queueType === "genre") {
          window.api.genresData.getGenresData([queue.queueId]).then((res) => {
            if (res && res.length > 0 && res[0]) {
              setQueueInfo((prevData) => {
                return {
                  ...prevData,
                  artworkPath: res[0].artworkPaths.artworkPath,
                  title: res[0].name,
                };
              });
            }
          });
        }
        if (queue.queueType === "folder") {
          window.api.folderData.getFolderData([queue.queueId]).then((res) => {
            if (res && res.length > 0 && res[0]) {
              const folderName = res[0].path.split("\\").pop();
              setQueueInfo((prevData) => {
                return {
                  ...prevData,
                  artworkPath: FolderImg,
                  title: t(
                    folderName
                      ? "currentQueuePage.folderWithName"
                      : "common.unknownFolder",
                    {
                      name: folderName,
                    },
                  ),
                };
              });
            }
          });
        }
      }
    }
  }, [currentSongData.artworkPath, queue.queueId, queue.queueType, t]);

  const selectAllHandler = useSelectAllHandler(queuedSongs, "songs", "songId");

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return undefined;
    const updatedQueue = Array.from(currentQueue);
    const [item] = updatedQueue.splice(result.source.index, 1);
    updatedQueue.splice(result.destination.index, 0, item);

    updateQueueData(undefined, updatedQueue, undefined, undefined, true);

    return updateQueueData();
  };

  const centerCurrentlyPlayingSong = useCallback(() => {
    const index = currentQueue.indexOf(currentSongData.songId);
    if (ListRef && index >= 0)
      ListRef.current?.scrollToIndex({ index, align: "center" });
  }, [currentSongData.songId, currentQueue]);

  useEffect(() => {
    const timeOutId = setTimeout(() => centerCurrentlyPlayingSong(), 1000);

    return () => {
      if (timeOutId) clearTimeout(timeOutId);
    };
  }, [centerCurrentlyPlayingSong, isAutoScrolling]);

  const moreOptionsContextMenuItems = useMemo(
    () => [
      {
        label: t("currentQueuePage.scrollToCurrentPlayingSong"),
        iconName: "vertical_align_center",
        handlerFunction: centerCurrentlyPlayingSong,
      },
    ],
    [centerCurrentlyPlayingSong, t],
  );

  const queueDuration = useMemo(
    () =>
      calculateTimeFromSeconds(
        queuedSongs.reduce((prev, current) => prev + current.duration, 0),
      ).timeString,
    [queuedSongs],
  );

  const completedQueueDuration = useMemo(
    () =>
      calculateTimeFromSeconds(
        queuedSongs
          .slice(queue.currentSongIndex ?? 0)
          .reduce((prev, current) => prev + current.duration, 0),
      ).timeString,
    [queue.currentSongIndex, queuedSongs],
  );

  return (
    <MainContainer
      className="current-queue-container appear-from-bottom relative !h-full overflow-hidden !pb-0"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === "a") {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        <TitleContainer
          title={t("currentQueuePage.queue")}
          otherItems={
            currentQueue.length > 0
              ? [
                  <span key="meta" className="text-small text-ink-dim">
                    {t("common.songWithCount", { count: queuedSongs.length })},{" "}
                    {t("currentQueuePage.durationRemaining", {
                      duration: completedQueueDuration,
                    })}
                  </span>,
                ]
              : []
          }
          buttons={[
            {
              label: t("currentQueuePage.shuffleQueue"),
              iconName: "shuffle",
              className: "shuffle-all-button",
              isDisabled: currentQueue.length > 0 === false,
              clickHandler: () => {
                updateQueueData(undefined, currentQueue, true);
                fetchAllSongsData();
                addNewNotifications([
                  {
                    id: "shuffleQueue",
                    duration: 5000,
                    content: t("currentQueuePage.queueShuffleSuccess"),
                    iconName: "shuffle",
                  },
                ]);
              },
            },
            {
              iconName: isMultipleSelectionEnabled
                ? "remove_done"
                : "checklist",
              className: "select-btn",
              isActive: isMultipleSelectionEnabled,
              isDisabled: currentQueue.length > 0 === false,
              tooltipLabel: t(
                `common.${isMultipleSelectionEnabled ? "unselectAll" : "select"}`,
              ),
              clickHandler: () =>
                toggleMultipleSelections(!isMultipleSelectionEnabled, "songs"),
            },
            {
              iconName: isAutoScrolling ? "flash_off" : "flash_on",
              isActive: isAutoScrolling,
              isDisabled: currentQueue.length > 0 === false,
              tooltipLabel: t(
                `currentQueuePage.${isAutoScrolling ? "disableAutoScrolling" : "enableAutoScrolling"}`,
              ),
              clickHandler: () => setIsAutoScrolling((state) => !state),
            },
            ...moreOptionsContextMenuItems
              .filter(
                (item) => !(item as ContextMenuItem).isContextMenuItemSeperator,
              )
              .map((item) => ({
                label: item.label,
                iconName: item.iconName,
                inOverflowMenu: true,
                isDisabled: currentQueue.length > 0 === false,
                clickHandler: () => item.handlerFunction?.(),
              })),
            {
              label: t("currentQueuePage.clearQueue"),
              iconName: "clear_all",
              variant: "danger",
              inOverflowMenu: true,
              isDisabled: currentQueue.length > 0 === false,
              clickHandler: () => {
                updateQueueData(undefined, []);
                addNewNotifications([
                  {
                    id: "clearQueue",
                    duration: 5000,
                    content: t("currentQueuePage.queueCleared"),
                    iconName: "check",
                  },
                ]);
              },
            },
          ]}
        />
        {currentQueue.length > 0 && (
          <div className="queue-info-container mb-5 mr-4 flex items-center gap-4 rounded-panel bg-surface-1 p-3 text-ink">
            <Img
              className={`h-14 w-14 shrink-0 object-cover shadow-[0_6px_16px_rgb(0_0_0/0.3)] ${
                queue.queueType === "artist"
                  ? "artist-img rounded-full"
                  : `${queue.queueType}-img rounded-cover`
              }`}
              src={queueInfo.onlineArtworkPath}
              fallbackSrc={queueInfo.artworkPath}
              loading="eager"
              alt=""
            />
            <div className="queue-info min-w-0">
              <div className="queue-type text-small text-ink-dim">
                {t("currentQueuePage.playingFrom", "Playing from")}
              </div>
              <div className="queue-title truncate text-section font-semibold">
                {queueInfo.title}
              </div>
              <div className="queue-duration text-small text-ink-dim">
                {queueDuration}
              </div>
            </div>
          </div>
        )}
        {currentQueue.length > 0 && <SteeringBar />}
        <div
          className={`songs-container overflow-auto ${queuedSongs.length > 0 ? "h-full" : "h-0"}`}
        >
          {queuedSongs.length > 0 && (
            // $ Enabling StrictMode throws an error in the CurrentQueuePage when using react-beautiful-dnd for drag and drop.

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable
                droppableId="droppable"
                mode="virtual"
                renderClone={(provided, _, rubric) => {
                  const data = queuedSongs[rubric.source.index];
                  return (
                    <Song
                      provided={provided}
                      key={data.songId}
                      isDraggable
                      index={rubric.source.index}
                      ref={provided.innerRef}
                      isIndexingSongs={preferences?.isSongIndexingEnabled}
                      title={data.title}
                      songId={data.songId}
                      artists={data.artists}
                      album={data.album}
                      artworkPaths={data.artworkPaths}
                      duration={data.duration}
                      path={data.path}
                      isAFavorite={data.isAFavorite}
                      year={data.year}
                      isBlacklisted={data.isBlacklisted}
                      version={
                        "version" in data ? (data.version ?? null) : null
                      }
                    />
                  );
                }}
              >
                {(droppableProvided) => (
                  <VirtualizedList
                    data={queuedSongs}
                    fixedItemHeight={60}
                    ref={ListRef}
                    scrollerRef={droppableProvided.innerRef}
                    scrollTopOffset={currentlyActivePage.data?.scrollTopOffset}
                    components={{
                      Item: ({
                        children,
                        ...props
                      }: {
                        children?: ReactNode;
                      }) => (
                        <div {...props} className="height-preserving-container">
                          {children}
                        </div>
                      ),
                    }}
                    itemContent={(index, song) => {
                      return (
                        <Draggable
                          draggableId={song.songId}
                          index={index}
                          key={song.songId}
                        >
                          {(provided) => {
                            const { multipleSelections: songIds } =
                              multipleSelectionsData;
                            const isMultipleSelectionsEnabled =
                              multipleSelectionsData.selectionType ===
                                "songs" &&
                              multipleSelectionsData.multipleSelections
                                .length !== 1;

                            return (
                              <Song
                                provided={provided}
                                key={`${song.songId}-${index}`}
                                isDraggable
                                index={index}
                                ref={provided.innerRef}
                                isIndexingSongs={
                                  preferences?.isSongIndexingEnabled
                                }
                                {...song}
                                trackNo={undefined}
                                isShuffleReasonShown={
                                  isShuffleReasonShown &&
                                  queue.currentSongIndex !== null &&
                                  index > queue.currentSongIndex
                                }
                                selectAllHandler={selectAllHandler}
                                // no need for onPlayClick because the component is in the currentQueuePage
                                // onPlayClick={handleSongPlayBtnClick}
                                additionalContextMenuItems={[
                                  {
                                    label: t("common.removeFromQueue"),
                                    iconName: "remove_circle_outline",
                                    handlerFunction: () => {
                                      updateQueueData(
                                        undefined,
                                        currentQueue.filter((id) =>
                                          isMultipleSelectionsEnabled
                                            ? !songIds.includes(id)
                                            : id !== song.songId,
                                        ),
                                      );
                                      toggleMultipleSelections(false);
                                    },
                                  },
                                ]}
                              />
                            );
                          }}
                        </Draggable>
                      );
                    }}
                  />
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>
        {currentQueue.length === 0 && (
          <EmptyState
            className="no-songs-container h-full"
            iconName="queue_music"
            title={t("currentQueuePage.empty")}
          />
        )}
      </>
    </MainContainer>
  );
};
CurrentQueuePage.displayName = "CurrentQueuePage";
export default CurrentQueuePage;
