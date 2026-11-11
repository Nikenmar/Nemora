import { lazy, memo, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { explainSong, reasonsOf, type Reason } from '../../other/smartShuffle';
import { cn } from './cn';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

const WhyThisSongPrompt = lazy(() => import('../WhyThisSongPrompt'));

/** Whether Smart Shuffle is on and its reasons are shown (Settings > Audio playback > Smart Shuffle). */
export const useShuffleReasonsShown = () =>
  useStore(
    store,
    (state) =>
      state.player.isTierShuffling && !state.localStorage.preferences.isShuffleReasonsHidden
  );

/**
 * The strongest reason Smart Shuffle has for `songId` (PLAN/14 C1), as one short muted phrase. With the
 * song's `title` it is a link: it opens Why this song? for that song, the whole weighing behind it.
 */
const ShuffleReason = memo(({ songId, title, className }: { songId: string; title?: string; className?: string }) => {
  const { t } = useTranslation();
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const [reason, setReason] = useState<Reason | null>(null);

  useEffect(() => {
    let current = true;
    explainSong(songId)
      .then((e) => current && setReason(e ? (reasonsOf(e)[0] ?? { key: 'plain', strength: 0 }) : null))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [songId]);

  if (!reason) return null;
  const text = t(`smartShuffle.reasons.${reason.key}`, { ...reason.values });
  if (!title) return <span className={cn('shuffle-reason truncate text-ink-faint', className)}>{text}</span>;
  const open = () =>
    changePromptMenuData(true, <WhyThisSongPrompt songId={songId} title={title} />, '!max-w-[34rem]');
  return (
    <span
      role="button"
      tabIndex={0}
      data-tooltip={t('smartShuffle.whyThisSong')}
      className={cn(
        'shuffle-reason cursor-pointer truncate text-ink-faint underline-offset-2 outline-none transition-colors hover:text-ink-dim hover:underline focus-visible:underline',
        className
      )}
      // The row under it plays the song on a click and opens its menu on a right click.
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
    >
      {text}
    </span>
  );
});

ShuffleReason.displayName = 'ShuffleReason';
export default ShuffleReason;
