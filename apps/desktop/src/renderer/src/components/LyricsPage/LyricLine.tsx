/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import roundTo from '../../../../common/roundTo';
import { syncedLyricsRegex } from './LyricsPage';
import LyricsProgressBar from './LyricsProgressBar';
import EnhancedSyncedLyricWord from '../LyricsEditingPage/EnhancedSyncedLyricWord';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

interface LyricProp {
  lyric: string | SyncedLyricsLineWord[];
  translatedLyricLines?: TranslatedLyricLine[];
  convertedLyric?: string | SyncedLyricsLineWord[];
  index: number;
  syncedLyrics?: { start: number; end: number };
  isAutoScrolling?: boolean;
}

const lyricsScrollIntoViewEvent = new CustomEvent('lyrics/scrollIntoView', {
  detail: 'scrollingUsingScrollIntoView'
});

const LyricLine = (props: LyricProp) => {
  const playerType = useStore(store, (state) => state.playerType);
  // const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { updateSongPosition, updateContextMenuData } = useContext(AppUpdateContext);
  const [isInRange, setIsInRange] = useState(false);
  const { t } = useTranslation();

  const lyricsRef = useRef(null as HTMLDivElement | null);
  const isTheCurrnetLineRef = useRef(false);

  const {
    index,
    lyric,
    translatedLyricLines = [],
    convertedLyric,
    syncedLyrics,
    isAutoScrolling = true
  } = props;

  const handleLyricsActivity = useCallback(
    (e: Event) => {
      if ('detail' in e && !Number.isNaN(e.detail)) {
        const songPosition = e.detail as number;

        if (lyricsRef.current && syncedLyrics) {
          const { start, end } = syncedLyrics;
          if (songPosition > start && songPosition < end) {
            if (!isTheCurrnetLineRef.current) {
              isTheCurrnetLineRef.current = true;
              setIsInRange(true);
              if (isAutoScrolling)
                lyricsRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
                });

              document.dispatchEvent(lyricsScrollIntoViewEvent);
            }
          } else {
            isTheCurrnetLineRef.current = false;
            setIsInRange(false);
          }
        }
      }
    },
    [isAutoScrolling, syncedLyrics]
  );

  useEffect(() => {
    document.addEventListener('player/positionChange', handleLyricsActivity);

    return () => document.removeEventListener('player/positionChange', handleLyricsActivity);
  }, [handleLyricsActivity]);

  const lyricString = useMemo(() => {
    if (typeof lyric === 'string') return lyric.replaceAll(syncedLyricsRegex, '').trim();

    const extendedLyricLines = lyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, lyric]);

  const translatedLyricString = useMemo(() => {
    if (translatedLyricLines.length === 0) return undefined;

    const translatedLyric = translatedLyricLines[0].text;
    if (typeof translatedLyric === 'string')
      return translatedLyric.replaceAll(syncedLyricsRegex, '').trim();

    const extendedLyricLines = translatedLyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, translatedLyricLines]);

  const convertedLyricString = useMemo(() => {
    if (!convertedLyric || convertedLyric.length === 0) return undefined;
    if (typeof convertedLyric === 'string')
      return convertedLyric.replaceAll(syncedLyricsRegex, '').trim();

    const extendedLyricLines = convertedLyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, convertedLyric]);

  const lyricStringLinePrimary = translatedLyricString ?? convertedLyricString ?? lyricString;
  let lyricStringLineSecondaryUpper;
  // if (!preferences.compactLyrics && translatedLyricString)
  if (translatedLyricString) lyricStringLineSecondaryUpper = convertedLyricString ?? lyricString;

  return (
    <div
      style={{
        animationDelay: `${100 + 20 * (index + 1)}ms`
      }}
      title={
        syncedLyrics
          ? t(`lyricsEditingPage.fromTo`, {
              start: roundTo(syncedLyrics.start, 2),
              end: roundTo(syncedLyrics.end, 2)
            })
          : undefined
      }
      className={`highlight z-0 mb-5 flex w-fit select-none flex-col items-center justify-center text-balance text-center text-[28px] font-semibold leading-[1.2] text-ink transition-[transform,color,filter] duration-300 ease-out first:mt-8 last:mb-4 empty:mb-16 ${
        syncedLyrics
          ? `cursor-pointer ${
              isInRange
                ? '!scale-100 !text-opacity-100 [&>div>span]:!mr-3'
                : 'scale-[.86] !text-opacity-25 blur-[0.5px] hover:!text-opacity-60'
            }`
          : '!text-[24px]'
      } ${playerType === 'mini' && '!mb-2 !text-xl !text-on-media'} ${
        playerType === 'full' &&
        '!mb-6 origin-left !items-start !justify-start !text-left !text-[40px] !leading-[1.15] !text-on-media'
      }`}
      ref={lyricsRef}
      onClick={() =>
        syncedLyrics &&
        (typeof lyric === 'string' || translatedLyricString) &&
        updateSongPosition(syncedLyrics.start)
      }
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(
          true,
          [
            {
              label: t('common.copy'),
              class: 'sync',
              iconName: 'content_copy',
              iconClassName: 'ms-icon',
              handlerFunction: () =>
                window.navigator.clipboard.writeText(
                  typeof lyric === 'string'
                    ? lyric.replaceAll(syncedLyricsRegex, '').trim()
                    : lyric.map((x) => x.text).join(' ')
                )
            }
          ],
          e.pageX,
          e.pageY
        );
      }}
    >
      {lyricStringLineSecondaryUpper && (
        <div
          className={`flex flex-row flex-wrap ${playerType !== 'full' && 'items-center justify-center'} ${syncedLyrics && isInRange ? '!text-xl !text-ink/50' : '!text-xl'}`}
        >
          {lyricStringLineSecondaryUpper}
        </div>
      )}
      <div
        className={`flex flex-row flex-wrap ${playerType !== 'full' && 'items-center justify-center'}`}
      >
        {lyricStringLinePrimary}
      </div>
      {syncedLyrics && isInRange && <LyricsProgressBar delay={0} syncedLyrics={syncedLyrics} />}
    </div>
  );
};

export default LyricLine;
