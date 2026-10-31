/* eslint-disable jsx-a11y/no-static-element-interactions */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { reportUpNextToObsWidget } from '../../other/obsWidgetFeed';

type Props = {
  onPopupAppears: (isVisible: boolean) => void;
  isSemiTransparent?: boolean;
  className?: string;
};

const UpNextSongPopup = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const queue = useStore(store, (state) => state.localStorage.queue);

  const {
    changeCurrentActivePage
    // changeUpNextSongData
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { onPopupAppears, isSemiTransparent = false, className } = props;

  const [upNextSongData, setUpNextSongData] = useState<SongData>();
  const upNextSongDataCache = useRef<SongData>(undefined);

  useEffect(() => {
    onPopupAppears(!!upNextSongData);
    // The OBS widget shows the pill at the same moments this popup does, so it
    // is told from here rather than running a schedule of its own.
    reportUpNextToObsWidget(upNextSongData);
  }, [onPopupAppears, upNextSongData]);

  const showPopup = useCallback(() => {
    setUpNextSongData(upNextSongDataCache.current);
    setTimeout(() => setUpNextSongData(undefined), 10000);
  }, []);

  useEffect(() => {
    let ctrlPressed = false;
    let lastCtrlPressTime = 0;
    const abortController = new AbortController();

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Control') {
          const currentTime = new Date().getTime();
          if (currentTime - lastCtrlPressTime < 300 && ctrlPressed) {
            // Double Ctrl key press detected
            console.log('Double Ctrl key press detected');
            // Add your logic here
            showPopup();

            // Reset flag and time for next detection
            ctrlPressed = false;
            lastCtrlPressTime = 0;
          } else {
            // First Ctrl key press or not in quick succession
            ctrlPressed = true;
            lastCtrlPressTime = currentTime;
          }
        }
      },
      { signal: abortController.signal }
    );

    document.addEventListener(
      'keyup',
      (event) => {
        if (event.key === 'Control') {
          // Reset flag on Ctrl key release
          ctrlPressed = false;
          lastCtrlPressTime = 0;
        }
      },
      { signal: abortController.signal }
    );

    return () => {
      abortController.abort();
    };
  }, [showPopup]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let timeIntervalId: ReturnType<typeof setTimeout>;
    if (queue.queue.length > 1 && queue.currentSongIndex !== null) {
      setUpNextSongData(undefined);
      const nextSongIndex = queue.queue[queue.currentSongIndex + 1];

      if (nextSongIndex) {
        timeoutId = setTimeout(
          () =>
            window.api.audioLibraryControls
              .getSongInfo([nextSongIndex])
              .then((res) => {
                if (res && res[0]) {
                  const [nextSongData] = res;
                  upNextSongDataCache.current = nextSongData;
                  // changeUpNextSongData(upNextSongDataCache.current);

                  timeIntervalId = setInterval(showPopup, 40000);
                }

                return undefined;
              })
              .catch((err) => console.error(err)),
          5000
        );
      }
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (timeIntervalId) clearInterval(timeIntervalId);
    };
  }, [queue.currentSongIndex, queue.queue, showPopup]);

  const showSongInfoPage = useCallback(
    (songId: string) =>
      currentSongData.isKnownSource
        ? changeCurrentActivePage('SongInfo', {
            songId
          })
        : undefined,
    [changeCurrentActivePage, currentSongData.isKnownSource]
  );

  return upNextSongData ? (
    <div
      className={`next-song appear-from-bottom group/nextSong relative flex max-w-full items-center text-micro text-ink-dim ${
        isSemiTransparent ? 'text-on-media/80' : ''
      } ${className}`}
    >
      <p className="truncate">
        <span className="font-medium text-echo">
          {t('player.upNext')}
        </span>{' '}
        <span
          className="cursor-pointer text-ink outline-none hover:underline focus-visible:outline-2 focus-visible:outline-echo"
          onClick={() => showSongInfoPage(upNextSongData.songId)}
          onKeyDown={(e) => e.key === 'Enter' && showSongInfoPage(upNextSongData.songId)}
        >
          {upNextSongData.title}
        </span>
        {upNextSongData.artists && upNextSongData.artists.length > 0 && (
          <>
            {' '}
            <span className="font-medium text-echo">
              {t('player.by')}
            </span>{' '}
            <span
              className="cursor-pointer outline-none hover:underline focus-visible:outline-2 focus-visible:outline-echo"
              onClick={() =>
                upNextSongData?.artists![0] &&
                changeCurrentActivePage('ArtistInfo', {
                  artistId: upNextSongData.artists[0].artistId
                })
              }
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                upNextSongData?.artists![0] &&
                changeCurrentActivePage('ArtistInfo', {
                  artistId: upNextSongData.artists[0].artistId
                })
              }
            >
              {upNextSongData.artists[0].name}
            </span>
            {upNextSongData.artists.length - 1 > 0 && (
              <span className="opacity-80"> +{upNextSongData.artists.length - 1}</span>
            )}
          </>
        )}
      </p>
      <Button
        iconName="close"
        tooltipLabel={t('player.closeUpNext')}
        size="sm"
        className="!m-0 ml-1 !hidden !h-5 !w-5 shrink-0 !text-echo group-hover/nextSong:!flex"
        clickHandler={() => setUpNextSongData(undefined)}
      />
    </div>
  ) : undefined;
};

export default UpNextSongPopup;
