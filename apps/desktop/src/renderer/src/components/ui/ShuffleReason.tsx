import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { explainSong, reasonsOf, type Reason } from '../../other/smartShuffle';
import { cn } from './cn';

/** Whether Smart Shuffle is on and its reasons are shown (Settings > Audio playback > Smart Shuffle). */
export const useShuffleReasonsShown = () =>
  useStore(
    store,
    (state) =>
      state.player.isTierShuffling && !state.localStorage.preferences.isShuffleReasonsHidden
  );

/** The strongest reason Smart Shuffle has for `songId` (PLAN/14 C1), as one short muted phrase. */
const ShuffleReason = memo(({ songId, className }: { songId: string; className?: string }) => {
  const { t } = useTranslation();
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
  return (
    <span className={cn('shuffle-reason truncate text-ink-faint', className)}>
      {t(`smartShuffle.reasons.${reason.key}`, { ...reason.values })}
    </span>
  );
});

ShuffleReason.displayName = 'ShuffleReason';
export default ShuffleReason;
