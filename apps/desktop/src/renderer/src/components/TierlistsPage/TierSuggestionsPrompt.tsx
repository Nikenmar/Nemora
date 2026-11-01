import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../Button';
import EmptyState from '../ui/EmptyState';

type Row = TierSuggestion & { title: string };

/**
 * Tier suggestions (PLAN/15 T2): songs whose duels put them a tier away from where they are. Each
 * line moves its song only when the user applies it, or goes away for good when dismissed.
 */
const TierSuggestionsPrompt = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let current = true;
    window.api.tierlistsData
      .getTierSuggestions()
      .then(async (suggestions) => {
        const songs = suggestions.length
          ? await window.api.audioLibraryControls.getSongInfo(suggestions.map((s) => s.songId))
          : [];
        const titles = new Map((songs ?? []).map((song) => [song.songId, song.title]));
        if (current) setRows(suggestions.map((s) => ({ ...s, title: titles.get(s.songId) ?? s.songId })));
        return undefined;
      })
      .catch(() => current && setRows([]));
    return () => {
      current = false;
    };
  }, []);

  const settle = useCallback((row: Row, apply: boolean) => {
    const done = apply
      ? window.api.tierlistsData.applyTierSuggestion(row.tierlistId, row.songId, row.to)
      : window.api.tierlistsData.dismissTierSuggestion(row.tierlistId, row.songId, row.to);
    done
      .then(() =>
        setRows((current) =>
          (current ?? []).filter((r) => !(r.tierlistId === row.tierlistId && r.songId === row.songId))
        )
      )
      .catch((error: unknown) => console.error(error));
  }, []);

  return (
    <div className="tier-suggestions w-full">
      <div className="title-container mb-2 mt-1 pr-4 text-title font-semibold text-ink">
        {t('tierSuggestions.title')}
      </div>
      <p className="mb-5 text-small text-ink-dim">{t('tierSuggestions.description')}</p>
      {rows === null && <div className="h-24 animate-pulse rounded-panel bg-surface-2" />}
      {rows?.length === 0 && (
        <EmptyState className="py-6" iconName="check_circle" title={t('tierSuggestions.none')} />
      )}
      {rows && rows.length > 0 && (
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-auto pr-1">
          {rows.map((row) => (
            <li
              key={`${row.tierlistId}:${row.songId}`}
              className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{row.title}</div>
                <div className="truncate text-small text-ink-dim">
                  {t(row.to < row.from ? 'tierSuggestions.up' : 'tierSuggestions.down', {
                    tierlist: row.tierlist,
                    from: row.fromName,
                    to: row.toName,
                    games: row.games
                  })}
                </div>
              </div>
              <Button
                label={t('tierSuggestions.apply', { to: row.toName })}
                variant="primary"
                className="!mr-0 text-sm"
                clickHandler={() => settle(row, true)}
              />
              <Button
                iconName="close"
                tooltipLabel={t('tierSuggestions.dismiss')}
                className="!mr-0"
                clickHandler={() => settle(row, false)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TierSuggestionsPrompt;
