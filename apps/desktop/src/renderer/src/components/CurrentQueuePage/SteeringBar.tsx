import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { steer, steeringStore } from '../../other/smartShuffle';
import Icon from '../ui/Icon';

type Chip = { what: 'lessArtists' | 'moreLike' | 'notNow'; value: string; label: string };

const FILTERS = ['onlyUnheard', 'onlyRanked', 'boostNew'] as const;

/**
 * The queue's Smart Shuffle steering (PLAN/14 C2): each active action as a chip that removes it,
 * and the session filters (C4) as toggles when the user has switched them on in Settings.
 */
const SteeringBar = memo(() => {
  const { t } = useTranslation();
  const isOn = useStore(store, (state) => state.player.isTierShuffling);
  const isSteeringShown = useStore(store, (state) => !state.localStorage.preferences.isShuffleSteeringHidden);
  const areFiltersShown = useStore(store, (state) => !!state.localStorage.preferences.isSessionFiltersEnabled);
  const steering = useStore(steeringStore, (state) => state);

  if (!isOn) return null;
  const name = (id: string) => steering.titles[id] ?? id;
  const chips: Chip[] = isSteeringShown
    ? [
        ...steering.lessArtists.map((value) => ({
          what: 'lessArtists' as const,
          value,
          label: t('smartShuffle.chipLess', { name: value })
        })),
        ...steering.moreLike.map((value) => ({
          what: 'moreLike' as const,
          value,
          label: t('smartShuffle.chipMore', { name: name(value) })
        })),
        ...steering.notNow.map((value) => ({
          what: 'notNow' as const,
          value,
          label: t('smartShuffle.chipNotNow', { name: name(value) })
        }))
      ]
    : [];
  if (chips.length === 0 && !areFiltersShown) return null;

  const chip =
    'inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-full px-3 text-small outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-echo';

  return (
    <div className="steering-bar mb-4 mr-4 flex flex-wrap items-center gap-2">
      {chips.length > 0 && (
        <span className="mr-1 text-small text-ink-dim">{t('smartShuffle.steering')}</span>
      )}
      {chips.map((c) => (
        <button
          key={`${c.what}:${c.value}`}
          type="button"
          className={`${chip} bg-accent-soft text-ink hover:bg-line/70`}
          aria-label={`${t('smartShuffle.removeSteering')}: ${c.label}`}
          onClick={() => steer({ kind: 'remove', what: c.what, value: c.value })}
        >
          <span className="truncate">{c.label}</span>
          <Icon name="close" size={14} />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          className={`${chip} text-ink-dim hover:text-ink`}
          onClick={() => steer({ kind: 'clear' })}
        >
          {t('smartShuffle.clearSteering')}
        </button>
      )}
      {areFiltersShown && (
        <>
          <span className="ml-2 mr-1 text-small text-ink-dim">{t('smartShuffle.filters')}</span>
          {FILTERS.map((filter) => {
            const isActive = steering[filter];
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={isActive}
                className={`${chip} ${
                  isActive ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink hover:bg-line/70'
                }`}
                onClick={() => steer({ kind: 'filter', filter, isOn: !isActive })}
              >
                {isActive && <Icon name="check" size={14} />}
                <span className="truncate">{t(`smartShuffle.${filter}`)}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
});

SteeringBar.displayName = 'SteeringBar';
export default SteeringBar;
