import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { explainSong, reasonsOf } from '../other/smartShuffle';

type Part = {
  key: 'tier' | 'artist' | 'elo' | 'listens' | 'engagement' | 'freshness' | 'skip' | 'weight';
  value: number;
};

/**
 * "Why this song?" (PLAN/14 C1): every part of the song's Smart Shuffle weight as a bar, and its
 * reasons in words. Parts that do not apply (ELO before enough duels) are left out.
 */
const WhyThisSongPrompt = ({ songId, title }: { songId: string; title: string }) => {
  const { t } = useTranslation();
  const [explanation, setExplanation] = useState<ShuffleExplanation | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    explainSong(songId)
      .then((e) => current && setExplanation(e ?? null))
      .catch(() => current && setExplanation(null));
    return () => {
      current = false;
    };
  }, [songId]);

  const parts: Part[] = explanation
    ? [
        { key: 'tier', value: explanation.tier },
        { key: 'artist', value: explanation.artist },
        ...(explanation.elo === null ? [] : [{ key: 'elo' as const, value: explanation.elo }]),
        { key: 'listens', value: explanation.listens },
        ...(explanation.engagement === null
          ? []
          : [{ key: 'engagement' as const, value: explanation.engagement }]),
        { key: 'freshness', value: explanation.freshness },
        { key: 'skip', value: explanation.skip },
        { key: 'weight', value: explanation.weight }
      ]
    : [];
  const reasons = explanation ? reasonsOf(explanation) : [];

  return (
    <div className="why-this-song w-full">
      <div className="title-container mb-2 mt-1 pr-4 text-title font-semibold text-ink">
        {t('smartShuffle.whyTitle', { title })}
      </div>
      <p className="mb-6 text-small text-ink-dim">{t('smartShuffle.whyDescription')}</p>
      {reasons.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-2">
          {reasons.slice(0, 3).map((reason) => (
            <li key={reason.key} className="rounded-full bg-accent-soft px-3 py-1 text-small text-ink">
              {t(`smartShuffle.reasons.${reason.key}`, { ...reason.values })}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-2.5">
        {parts.map((part) => (
          <div key={part.key} className="contents">
            <dt className={`text-small ${part.key === 'weight' ? 'font-semibold text-ink' : 'text-ink-dim'}`}>
              {t(`smartShuffle.parts.${part.key}`)}
            </dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full ${part.key === 'weight' ? 'bg-echo' : 'bg-ink-dim'}`}
                style={{ width: `${Math.round(Math.min(1, Math.max(0, part.value)) * 100)}%` }}
              />
            </dd>
            <dd className="text-right text-micro tabular-nums text-ink-faint">
              {Math.round(part.value * 100)}
            </dd>
          </div>
        ))}
      </dl>
      {explanation === null && <p className="text-small text-ink-dim">{t('smartShuffle.reasons.plain')}</p>}
    </div>
  );
};

export default WhyThisSongPrompt;
