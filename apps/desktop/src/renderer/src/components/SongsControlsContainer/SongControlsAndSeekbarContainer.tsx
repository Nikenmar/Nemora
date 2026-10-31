import { useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";
import { AppUpdateContext } from "../../contexts/AppUpdateContext";
import Button from "../Button";
import Icon from "../ui/Icon";
import SeekBarContainer from "./SeekBarContainer";
import { useStore } from "@tanstack/react-store";
import { store } from "@renderer/store";

const SongControlsAndSeekbarContainer = () => {
  const currentlyActivePage = useStore(
    store,
    (state) => state.currentlyActivePage,
  );
  const isShuffling = useStore(store, (state) => state.player.isShuffling);
  const isTierShuffling = useStore(
    store,
    (state) => state.player.isTierShuffling,
  );
  const isRepeating = useStore(store, (state) => state.player.isRepeating);
  const isCurrentSongPlaying = useStore(
    store,
    (state) => state.player.isCurrentSongPlaying,
  );
  const isPlayerStalled = useStore(
    store,
    (state) => state.player.isPlayerStalled,
  );

  const {
    changeCurrentActivePage,
    updateQueueData,
    toggleRepeat,
    toggleTierShuffle,
    toggleSongPlayback,
    handleSkipForwardClick,
    handleSkipBackwardClick,
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const handleQueueShuffle = useCallback(() => {
    if (isShuffling) updateQueueData(undefined, undefined, false, false, true);
    else {
      toggleTierShuffle(false); // mutually exclusive with Mega Smart Shuffle
      updateQueueData(undefined, undefined, true, undefined, false);
    }
  }, [isShuffling, toggleTierShuffle, updateQueueData]);

  const toggleLook = (isOn: boolean) =>
    `!m-0 !h-8 !w-8 ${isOn ? "!text-echo hover:!text-echo" : ""}`;

  // Three equal gaps in the 76 px bar: 12 above play, 12 between play and the seek track, 12 below
  // it (36 + 4 + 3 x 12 = 76). The seek row is 24 px with its 4 px track in the middle, so it sits
  // 2 px under play. Fixed offsets, not centring: centring the row and the seek row as one block
  // put the gaps at 8, 16 and 12.
  return (
    <div className="song-controls-and-seekbar-container flex min-w-0 flex-col items-center justify-start gap-0.5 self-stretch pt-3">
      {/* Three controls a side, mirrored in size, in equal columns: play sits exactly over the middle
          of the seek bar whatever the icons' widths. */}
      <div className="controls-container grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            className={`tier-shuffle-btn ${toggleLook(isTierShuffling)}`}
            tooltipLabel={t("player.tierShuffle")}
            iconName="auto_fix"
            isActive={isTierShuffling}
            clickHandler={() => toggleTierShuffle()}
          />
          <Button
            className={`shuffle-btn ${toggleLook(isShuffling)}`}
            tooltipLabel={t("player.shuffle")}
            iconName="shuffle"
            isActive={isShuffling}
            clickHandler={handleQueueShuffle}
          />
          <Button
            className="skip-back-btn !m-0 !h-9 !w-9 !text-ink hover:!bg-transparent hover:opacity-80"
            tooltipLabel={t("player.prevSong")}
            iconName="skip_previous"
            isActive
            size="lg"
            clickHandler={handleSkipBackwardClick}
          />
        </div>
        <button
          type="button"
          className={`play-pause-btn relative mx-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-ink text-canvas outline-none transition-transform duration-150 ease-out hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo ${
            isPlayerStalled ? "cursor-progress" : ""
          }`}
          aria-label={t("player.playPause")}
          data-tooltip={t("player.playPause")}
          onClick={() => !isPlayerStalled && toggleSongPlayback()}
        >
          {isPlayerStalled ? (
            <span
              className="h-4 w-4 animate-spin-ease rounded-full border-2 border-canvas border-t-transparent"
              aria-hidden
            />
          ) : (
            <Icon
              name={isCurrentSongPlaying ? "pause" : "play_arrow"}
              filled
              size={24}
            />
          )}
        </button>
        <div className="flex items-center justify-start gap-1.5">
          <Button
            className="skip-forward-btn !m-0 !h-9 !w-9 !text-ink hover:!bg-transparent hover:opacity-80"
            tooltipLabel={t("player.nextSong")}
            iconName="skip_next"
            isActive
            size="lg"
            clickHandler={() => handleSkipForwardClick("USER_SKIP")}
          />
          <Button
            className={`repeat-btn ${toggleLook(isRepeating !== "false")}`}
            tooltipLabel={t("player.repeat")}
            iconName={
              isRepeating === "false" || isRepeating === "repeat"
                ? "repeat"
                : "repeat_one"
            }
            isActive={isRepeating !== "false"}
            clickHandler={() => toggleRepeat()}
          />
          <Button
            className={`lyrics-btn ${toggleLook(currentlyActivePage.pageTitle === "Lyrics")}`}
            tooltipLabel={t("player.lyrics")}
            iconName="lyrics"
            isActive={currentlyActivePage.pageTitle === "Lyrics"}
            clickHandler={() =>
              currentlyActivePage.pageTitle === "Lyrics"
                ? changeCurrentActivePage("Home")
                : changeCurrentActivePage("Lyrics")
            }
          />
        </div>
      </div>
      <SeekBarContainer />
    </div>
  );
};

export default SongControlsAndSeekbarContainer;
