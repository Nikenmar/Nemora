import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../Button';
import Dropdown from '../Dropdown';

export type SongGuessrPoolSelection = {
  poolType: SongGuessrPoolType;
  poolId?: string;
};

type SongGuessrPoolSelectorProps = {
  pools: SongGuessrPoolOption[];
  selection: SongGuessrPoolSelection;
  disabled: boolean;
  onChange: (selection: SongGuessrPoolSelection) => void;
};

const TARGETED_POOL_TYPES: Exclude<SongGuessrPoolType, 'library'>[] = [
  'artist',
  'album',
  'playlist',
  'genre'
];

const pickRandomPool = (pools: SongGuessrPoolOption[]): SongGuessrPoolOption | undefined => {
  if (pools.length === 0) return undefined;
  return pools[Math.min(pools.length - 1, Math.floor(Math.random() * pools.length))];
};

const FIELD_LABEL = 'text-micro font-semibold uppercase tracking-wide text-ink-faint';

const SongGuessrPoolSelector = (props: SongGuessrPoolSelectorProps) => {
  const { pools, selection, disabled, onChange } = props;
  const { t } = useTranslation();

  const poolsByType = useMemo(
    () =>
      new Map(
        TARGETED_POOL_TYPES.map((poolType) => [
          poolType,
          pools.filter((pool) => pool.type === poolType)
        ])
      ),
    [pools]
  );

  const modeOptions = useMemo(
    () => [
      { value: 'library', label: t('songGuessr.modeLibrary') },
      { value: 'artist', label: t('songGuessr.modeArtist') },
      { value: 'album', label: t('songGuessr.modeAlbum') },
      ...(poolsByType.get('playlist')?.length
        ? [{ value: 'playlist', label: t('songGuessr.modePlaylist') }]
        : []),
      ...(poolsByType.get('genre')?.length
        ? [{ value: 'genre', label: t('songGuessr.modeGenre') }]
        : [])
    ],
    [poolsByType, t]
  );

  const targetPools =
    selection.poolType === 'library' ? [] : (poolsByType.get(selection.poolType) ?? []);
  const availableTargetOptions = targetPools.map((pool) => ({
    value: pool.id ?? '',
    label: t('songGuessr.poolWithCount', { name: pool.name, count: pool.count })
  }));
  const selectedPoolValue = selection.poolId ?? '';
  const hasSelectedPool = targetPools.some((pool) => pool.id === selection.poolId);
  const targetOptions = [
    ...(!hasSelectedPool
      ? [
          {
            value: selectedPoolValue,
            label: selection.poolId
              ? t('songGuessr.unavailablePool')
              : selection.poolType === 'artist'
                ? t('songGuessr.chooseArtist')
                : selection.poolType === 'album'
                  ? t('songGuessr.chooseAlbum')
                  : t('songGuessr.choosePool'),
            isDisabled: true
          }
        ]
      : []),
    ...availableTargetOptions
  ];
  const supportsRandom = selection.poolType === 'artist' || selection.poolType === 'album';

  const chooseRandomTarget = () => {
    const pool = pickRandomPool(targetPools);
    if (pool?.id) onChange({ poolType: selection.poolType, poolId: pool.id });
  };

  const changeMode = (poolType: SongGuessrPoolType) => {
    if (poolType === 'library') {
      onChange({ poolType });
      return;
    }

    const availablePools = poolsByType.get(poolType) ?? [];
    const nextPool =
      poolType === 'artist' || poolType === 'album'
        ? pickRandomPool(availablePools)
        : availablePools[0];
    onChange({ poolType, ...(nextPool?.id ? { poolId: nextPool.id } : {}) });
  };

  return (
    <section
      className="mb-5 flex flex-shrink-0 flex-wrap items-end gap-2"
      aria-label={t('songGuessr.sourceLabel')}
    >
      <label className="flex min-w-32 flex-1 flex-col gap-1.5">
        <span className={FIELD_LABEL}>{t('songGuessr.modeLabel')}</span>
        <Dropdown
          name="song-guessr-mode"
          value={selection.poolType}
          options={modeOptions}
          onChange={(event) => changeMode(event.target.value as SongGuessrPoolType)}
          className="ml-0 h-9 w-full max-w-none [&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:text-left"
          isDisabled={disabled}
        />
      </label>

      {selection.poolType !== 'library' && (
        <label className="flex min-w-40 flex-[1.6] flex-col gap-1.5">
          <span className={FIELD_LABEL}>
            {selection.poolType === 'artist'
              ? t('songGuessr.artistLabel')
              : selection.poolType === 'album'
                ? t('songGuessr.albumLabel')
                : t('songGuessr.poolLabel')}
          </span>
          <Dropdown
            name="song-guessr-target-pool"
            value={selectedPoolValue}
            options={targetOptions}
            onChange={(event) =>
              onChange({ poolType: selection.poolType, poolId: event.target.value })
            }
            className="ml-0 h-9 w-full max-w-none [&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:text-left"
            isDisabled={disabled || availableTargetOptions.length === 0}
          />
        </label>
      )}

      {supportsRandom && (
        <Button
          iconName="shuffle"
          variant="secondary"
          size="lg"
          tooltipLabel={
            selection.poolType === 'artist'
              ? t('songGuessr.randomArtist')
              : t('songGuessr.randomAlbum')
          }
          isDisabled={disabled || targetPools.length === 0}
          className="m-0 h-9 w-9"
          clickHandler={chooseRandomTarget}
        />
      )}
    </section>
  );
};

export default SongGuessrPoolSelector;
