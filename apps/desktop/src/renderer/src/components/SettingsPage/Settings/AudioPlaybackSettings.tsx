import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown, { type DropdownOption } from '../../Dropdown';
import storage from '../../../utils/localStorage';

import Button from '../../Button';
import Checkbox from '../../Checkbox';
import i18n from '../../../i18n';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';
import { loadShuffleData, reorderRemaining } from '../../../other/smartShuffle';

/**
 * Settings > Audio playback > Smart Shuffle (PLAN/14 C1-C5). Stored inverted where the default is
 * on, so an unset preference reads as the default.
 */
const SMART_SHUFFLE = [
  {
    group: 'groupExplain',
    items: [
      { key: 'isShuffleReasonsHidden', label: 'showReasons', inverted: true, reorders: false },
      { key: 'isShuffleSteeringHidden', label: 'steeringActions', inverted: true, reorders: false },
      { key: 'isSkipAwareDisabled', label: 'skipAware', inverted: true, reorders: true },
      { key: 'isSessionFiltersEnabled', label: 'sessionFilters', inverted: false, reorders: true },
      { key: 'isTasteMapHidden', label: 'tasteMap', inverted: true, reorders: false }
    ]
  },
  {
    group: 'groupLearning',
    items: [
      { key: 'isListeningLearningDisabled', label: 'learn', inverted: true, reorders: true },
      { key: 'isAdaptiveShuffleDisabled', label: 'adaptive', inverted: true, reorders: true },
      { key: 'isImplicitDuelsDisabled', label: 'implicitDuels', inverted: true, reorders: true }
    ]
  },
  {
    group: 'groupVariety',
    items: [
      { key: 'isFreshnessByDaysDisabled', label: 'freshnessByDays', inverted: true, reorders: true },
      { key: 'isFairRotationDisabled', label: 'fairRotation', inverted: true, reorders: true },
      { key: 'isArtistFatigueEnabled', label: 'artistFatigue', inverted: false, reorders: true }
    ]
  },
  {
    group: 'groupMemory',
    items: [
      { key: 'isForgottenFavouritesDisabled', label: 'forgottenFavourites', inverted: true, reorders: true },
      { key: 'isFavouriteMomentsEnabled', label: 'favouriteMoments', inverted: false, reorders: false }
    ]
  },
  {
    group: 'groupContext',
    items: [
      { key: 'isNightShuffleEnabled', label: 'night', inverted: false, reorders: true },
      { key: 'isEnergyFlowEnabled', label: 'energyFlow', inverted: false, reorders: true },
      { key: 'isFollowTasteMapEnabled', label: 'followMap', inverted: false, reorders: true }
    ]
  },
  {
    group: 'groupDuels',
    items: [{ key: 'isTeachingDuelsDisabled', label: 'teachingDuels', inverted: true, reorders: false }]
  }
] as const;

type SmartShuffleItem = (typeof SMART_SHUFFLE)[number]['items'][number];

/** PLAN/15's parts: on by default (stored as "disabled") and opt-in (stored as "enabled"). */
const NEW_DEFAULTS = [
  'isListeningLearningDisabled',
  'isAdaptiveShuffleDisabled',
  'isImplicitDuelsDisabled',
  'isFreshnessByDaysDisabled',
  'isFairRotationDisabled',
  'isForgottenFavouritesDisabled',
  'isTeachingDuelsDisabled'
] as const;
const NEW_OPTIONAL = [
  'isArtistFatigueEnabled',
  'isFavouriteMomentsEnabled',
  'isNightShuffleEnabled',
  'isEnergyFlowEnabled',
  'isFollowTasteMapEnabled'
] as const;

/** Classic: every new part off (3.0's shuffle). Recommended: the new defaults on, the rest off. */
const applyPreset = (classic: boolean) => {
  for (const key of NEW_DEFAULTS) storage.preferences.setPreferences(key, classic);
  for (const key of NEW_OPTIONAL) storage.preferences.setPreferences(key, false);
  window.api.tierlistsData.energyAnalysis(false).catch(() => undefined);
  if (store.state.player.isTierShuffling)
    loadShuffleData()
      .then(reorderRemaining)
      .catch((error) => console.error(error));
};

/** Skips in context (PLAN/16 D7): no setting, one line saying how skips are read, and the week. */
const SkipContextLine = () => {
  const { t } = useTranslation();
  const [context, setContext] = useState<SkipContext | null>(null);
  useEffect(() => {
    let isLive = true;
    window.api.tierlistsData
      .skipContext()
      .then((next) => isLive && setContext(next))
      .catch(() => undefined);
    return () => {
      isLive = false;
    };
  }, []);
  return (
    <div className="ml-8 mt-1 text-small text-ink-dim">
      <div>{t('smartShuffle.skipContext')}</div>
      {context && (context.counted > 0 || context.ignored > 0) && (
        <div className="tabular-nums">
          {t('smartShuffle.skipContextCount', { counted: context.counted, ignored: context.ignored })}
        </div>
      )}
    </div>
  );
};

/** Energy flow's measuring (PLAN/15 C2): how far it got, polled while it runs. */
const EnergyStatus = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EnergyAnalysis | null>(null);
  useEffect(() => {
    let isLive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () =>
      window.api.tierlistsData
        .energyAnalysis()
        .then((next) => {
          if (!isLive) return;
          setStatus(next);
          if (next.running) timer = setTimeout(poll, 2000);
        })
        .catch(() => undefined);
    poll();
    return () => {
      isLive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!status || status.total === 0) return null;
  return (
    <div className="ml-8 mt-1 text-small tabular-nums text-ink-dim">
      {t(status.running ? 'smartShuffle.energyRunning' : 'smartShuffle.energyProgress', {
        analysed: status.analysed,
        total: status.total
      })}
    </div>
  );
};

const second = i18n.t('settingsPage.second');
const seconds = i18n.t('settingsPage.second_other');

const seekbarScrollIntervals: DropdownOption<string>[] = [
  { label: `1 ${second}`, value: '1' },
  { label: `2.5 ${seconds}`, value: '2.5' },
  { label: `5 ${seconds}`, value: '5' },
  { label: `10 ${seconds}`, value: '10' },
  { label: `15 ${seconds}`, value: '15' },
  { label: `20 ${seconds}`, value: '20' }
];

const AudioPlaybackSettings = () => {
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { t } = useTranslation();

  const [seekbarScrollInterval, setSeekbarScrollInterval] = useState('5');

  const [playbackRateInterval, setPlaybackRateInterval] = useState(1);

  const [tierShuffleIntensity, setTierShuffleIntensity] = useState(0.6);

  useEffect(() => {
    const interval = storage.preferences.getPreferences('seekbarScrollInterval');
    const playbackRate = storage.playback.getPlaybackOptions('playbackRate');

    setPlaybackRateInterval(playbackRate);
    setSeekbarScrollInterval(interval.toString());
    setTierShuffleIntensity(storage.preferences.getPreferences('tierShuffleIntensity') ?? 0.6);
  }, []);

  const tierShuffleCssProperties = {
    '--seek-before-width': `${Math.round(tierShuffleIntensity * 100)}%`
  } as CSSProperties;

  const playbackRateSeekBarCssProperties: CSSProperties = {};

  playbackRateSeekBarCssProperties['--seek-before-width'] = `${
    ((playbackRateInterval - 0.25) / (4 - 0.25)) * 100
  }%`;

  return (
    <li className="main-container audio-playback-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">slow_motion_video</span>
        {t('settingsPage.audioPlayback')}
      </div>
      <ul className="list-disc pl-6 marker:bg-echo">
        <li className="secondary-container show-remaining-song-duration mb-4">
          <div className="description">
            {t('settingsPage.showRemainingSongDurationDescription')}
          </div>
          <Checkbox
            id="toggleShowRemainingSongDuration"
            isChecked={preferences?.showSongRemainingTime}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('showSongRemainingTime', state)
            }
            labelContent={t('settingsPage.showRemainingSongDuration')}
          />
        </li>

        <li className="secondary-container sound-in-file mb-4">
          <div className="description">{t('settingsPage.soundInFileDescription')}</div>
          <Checkbox
            id="toggleSoundInFile"
            isChecked={!preferences?.isSoundInFileDisabled}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('isSoundInFileDisabled', !state)
            }
            labelContent={t('settingsPage.soundInFile')}
          />
        </li>

        <li className="tier-shuffle-intensity mb-6">
          <div className="description">{t('settingsPage.tierShuffleIntensityDescription')}</div>
          <div className="mt-6 flex items-center">
            <div className="flex w-1/2 min-w-[120px] flex-col items-center justify-center">
              <span className="font-medium tabular-nums text-ink">
                {Math.round(tierShuffleIntensity * 100)}% {t('settingsPage.tierShuffleSmart')} /{' '}
                {100 - Math.round(tierShuffleIntensity * 100)}%{' '}
                {t('settingsPage.tierShuffleRandom')}
              </span>
              <div className="flex w-full items-center pl-2">
                <span className="text-sm">0</span>
                <input
                  type="range"
                  className="seek-bar-slider thumb-visible relative float-left mx-4 h-6 w-full appearance-none bg-[transparent] p-0 outline-none outline-1 outline-offset-1 before:absolute before:left-0 before:top-1/2 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:bg-echo before:transition-[width,background] before:content-[''] focus-visible:!outline "
                  min={0}
                  step={0.05}
                  max={1}
                  value={tierShuffleIntensity}
                  onChange={(e) => {
                    const val = e.currentTarget.valueAsNumber;
                    setTierShuffleIntensity(val);
                    storage.preferences.setPreferences('tierShuffleIntensity', val);
                  }}
                  style={tierShuffleCssProperties}
                  title={`${Math.round(tierShuffleIntensity * 100)}% smart`}
                />
                <span className="text-sm">100</span>
              </div>
            </div>
          </div>
        </li>

        <li className="secondary-container smart-shuffle-settings mb-6" id="smartShuffleSettings">
          <div className="description">
            <span className="font-semibold text-ink">{t('smartShuffle.settings')}</span>
            {'. '}
            {t('smartShuffle.settingsDescription')}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              label={t('smartShuffle.recommended')}
              tooltipLabel={t('smartShuffle.recommendedDescription')}
              className="!mr-0 text-sm"
              clickHandler={() => applyPreset(false)}
            />
            <Button
              label={t('smartShuffle.classic')}
              tooltipLabel={t('smartShuffle.classicDescription')}
              className="!mr-0 text-sm"
              clickHandler={() => applyPreset(true)}
            />
          </div>
          {SMART_SHUFFLE.map(({ group, items }) => (
            <div key={group} className="mt-5">
              <div className="text-small font-semibold uppercase tracking-wide text-ink-dim">
                {t(`smartShuffle.${group}`)}
              </div>
              {(items as readonly SmartShuffleItem[]).map(({ key, label, inverted, reorders }) => (
                <div key={key} className="mt-2">
                  <Checkbox
                    id={key}
                    isChecked={inverted ? !preferences?.[key] : !!preferences?.[key]}
                    checkedStateUpdateFunction={(state) => {
                      storage.preferences.setPreferences(key, inverted ? !state : state);
                      if (key === 'isEnergyFlowEnabled')
                        window.api.tierlistsData.energyAnalysis(state).catch(() => undefined);
                      if (reorders && store.state.player.isTierShuffling)
                        loadShuffleData()
                          .then(reorderRemaining)
                          .catch((error) => console.error(error));
                    }}
                    labelContent={t(`smartShuffle.${label}`)}
                  />
                  <div className="description ml-8 text-small text-ink-dim">
                    {t(`smartShuffle.${label}Description`)}
                  </div>
                  {key === 'isSkipAwareDisabled' && <SkipContextLine />}
                  {key === 'isEnergyFlowEnabled' && preferences?.isEnergyFlowEnabled && (
                    <EnergyStatus key={String(preferences.isEnergyFlowEnabled)} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </li>

        <li className="playback-rate mb-6" id="playbackRateInterval">
          <div className="description">{t('settingsPage.changePlaybackRate')}</div>
          <div className="mt-6 flex items-center">
            <div className="flex w-1/2 min-w-[120px] flex-col items-center justify-center">
              <span className="font-medium tabular-nums text-ink">
                {t('settingsPage.playbackRate')}: {playbackRateInterval} x
              </span>
              <div className="flex w-full items-center pl-2">
                <span className="text-sm">0.25x</span>
                <input
                  type="range"
                  name="seek-bar-slider"
                  id="seek-bar-slider"
                  className="seek-bar-slider thumb-visible relative float-left mx-4 h-6 w-full appearance-none bg-[transparent] p-0 outline-none outline-1 outline-offset-1 before:absolute before:left-0 before:top-1/2 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:bg-echo before:transition-[width,background] before:content-[''] hover:before:bg-echo focus-visible:!outline "
                  min={0.25}
                  step={0.05}
                  max={4.0}
                  value={playbackRateInterval || 1}
                  onChange={(e) => {
                    const val = e.currentTarget.valueAsNumber;
                    setPlaybackRateInterval(val);
                    storage.playback.setPlaybackOptions('playbackRate', val);
                  }}
                  style={playbackRateSeekBarCssProperties}
                  title={`${playbackRateInterval}x`}
                />
                <span className="text-sm">4x</span>
              </div>
            </div>
            <Button
              label={t('settingsPage.resetPlaybackRate')}
              iconName="restart_alt"
              className="ml-6"
              isDisabled={playbackRateInterval === 1}
              clickHandler={() => {
                setPlaybackRateInterval(1);
                storage.playback.setPlaybackOptions('playbackRate', 1);
              }}
            />
          </div>
        </li>

        <li className="seekbar-scroll-interval mb-4">
          <div className="description">{t('settingsPage.seekbarScrollInterval')}</div>
          <Dropdown
            className="mt-4"
            name="seekbarScrollInterval"
            value={seekbarScrollInterval?.toString()}
            options={seekbarScrollIntervals}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setSeekbarScrollInterval(val);
              storage.preferences.setPreferences('seekbarScrollInterval', parseFloat(val));
            }}
          />
        </li>
      </ul>
    </li>
  );
};

export default AudioPlaybackSettings;
