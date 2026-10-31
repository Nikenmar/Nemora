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
  { key: 'isShuffleReasonsHidden', label: 'showReasons', inverted: true, reorders: false },
  { key: 'isShuffleSteeringHidden', label: 'steeringActions', inverted: true, reorders: false },
  { key: 'isSkipAwareDisabled', label: 'skipAware', inverted: true, reorders: true },
  { key: 'isSessionFiltersEnabled', label: 'sessionFilters', inverted: false, reorders: true },
  { key: 'isTasteMapHidden', label: 'tasteMap', inverted: true, reorders: false }
] as const;

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
          {SMART_SHUFFLE.map(({ key, label, inverted, reorders }) => (
            <div key={key} className="mt-2">
              <Checkbox
                id={key}
                isChecked={inverted ? !preferences?.[key] : !!preferences?.[key]}
                checkedStateUpdateFunction={(state) => {
                  storage.preferences.setPreferences(key, inverted ? !state : state);
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
