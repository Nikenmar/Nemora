 
 

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import storage from '../../../utils/localStorage';

import ThemePreview from '../../ui/ThemePreview';

import Checkbox from '../../Checkbox';
import Icon from '../../ui/Icon';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  accentTokens,
  type AccentId
} from '../../../other/accentPalette';
import {
  DEFAULT_FRAME_SHADE,
  FRAME_SHADES,
  type FrameShadeId
} from '../../../other/framePalette';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

/** Settings > Appearance > Visuals (PLAN/14 B1-B4), all off until switched on. */
const VISUALS = [
  { key: 'isBreathingCoverLight', label: 'breathingCoverLight' },
  { key: 'isLiveRowEqualizer', label: 'liveRowEqualizer' },
  { key: 'isAmbientFullScreen', label: 'ambientFullScreen' },
  { key: 'isFullScreenSpectrum', label: 'fullScreenSpectrum' }
] as const;

const ThemeSettings = () => {
  const userData = useStore(store, (state) => state.userData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const isDarkMode = useStore(store, (state) => state.isDarkMode);
  const accent: AccentId =
    ACCENT_PRESETS.find((p) => p.id === preferences?.accentColor)?.id ?? DEFAULT_ACCENT;
  const frameShade: FrameShadeId =
    FRAME_SHADES.find((s) => s.id === preferences?.frameShade)?.id ?? DEFAULT_FRAME_SHADE;

  const { t } = useTranslation();

  const [theme, setTheme] = useState(userData?.theme);

  const fetchUserData = useCallback(
    () =>
      window.api.userData
        .getUserData()
        .then((res) => setTheme(res?.theme))
        .catch((err) => console.error(err)),
    []
  );

  useEffect(() => {
    fetchUserData();
    const manageUserDataUpdatesInSettingsPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (event.dataType.includes('userData')) fetchUserData();
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageUserDataUpdatesInSettingsPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageUserDataUpdatesInSettingsPage);
    };
  }, [fetchUserData]);

  const focusInput = useCallback((e: KeyboardEvent<HTMLLabelElement>) => {
    if (e.key === 'Enter') {
      const inputId = e.currentTarget.htmlFor;
      const inputElement = document.getElementById(inputId);
      inputElement?.click();
    }
  }, []);

  return theme ? (
    <li className="main-container appearance-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">dark_mode</span>
        {t('settingsPage.appearance')}
      </div>
      <ul className="list-disc pl-6 marker:bg-echo">
        <li>
          <div className="description">{t('settingsPage.changeTheme')}</div>
          <div className="theme-change-radio-btns flex max-w-3xl items-center justify-between pl-4 pt-4">
            <label
              htmlFor="lightThemeRadioBtn"
              tabIndex={0}
              className={`theme-change-radio-btn mb-2 flex cursor-pointer flex-col items-center rounded-panel bg-surface-2 p-4 outline-none transition-colors duration-150 focus-within:outline-2 focus-within:outline-echo hover:bg-line/60 ${
                !theme.useSystemTheme &&
                !theme.isDarkMode &&
                '!bg-accent-soft ring-2 ring-echo'
              }`}
              onKeyDown={focusInput}
            >
              <input
                type="radio"
                name="theme"
                className="peer invisible absolute -left-[9999px] mr-4"
                value="lightTheme"
                id="lightThemeRadioBtn"
                defaultChecked={!theme.useSystemTheme && !theme.isDarkMode}
                onClick={() => window.api.theme.changeAppTheme('light')}
              />
              <ThemePreview mode="light" />
              <span className="mt-3 text-body font-medium peer-checked:!text-echo">
                {t('settingsPage.lightTheme')}
              </span>
            </label>

            <label
              htmlFor="darkThemeRadioBtn"
              tabIndex={0}
              className={`theme-change-radio-btn mb-2 flex cursor-pointer flex-col items-center rounded-panel bg-surface-2 p-4 outline-none transition-colors duration-150 focus-within:outline-2 focus-within:outline-echo hover:bg-line/60 ${
                !theme.useSystemTheme &&
                theme.isDarkMode &&
                '!bg-accent-soft ring-2 ring-echo'
              }`}
              onKeyDown={focusInput}
            >
              <input
                type="radio"
                name="theme"
                className="peer invisible absolute -left-[9999px] mr-4"
                value="darkTheme"
                id="darkThemeRadioBtn"
                defaultChecked={!theme.useSystemTheme && theme.isDarkMode}
                onClick={() => window.api.theme.changeAppTheme('dark')}
              />
              <ThemePreview mode="dark" />
              <span className="mt-3 text-body font-medium peer-checked:!text-echo">
                {t('settingsPage.darkTheme')}
              </span>
            </label>

            <label
              htmlFor="systemThemeRadioBtn"
              tabIndex={0}
              className={`theme-change-radio-btn mb-2 flex cursor-pointer flex-col items-center rounded-panel bg-surface-2 p-4 outline-none transition-colors duration-150 focus-within:outline-2 focus-within:outline-echo hover:bg-line/60 ${
                theme.useSystemTheme && '!bg-accent-soft ring-2 ring-echo'
              } `}
              onKeyDown={focusInput}
            >
              <input
                type="radio"
                name="theme"
                className="peer invisible absolute -left-[9999px] mr-4"
                value="systemTheme"
                id="systemThemeRadioBtn"
                defaultChecked={theme.useSystemTheme}
                onClick={() => window.api.theme.changeAppTheme('system')}
              />
              <ThemePreview mode="system" />
              <span className="mt-3 text-body font-medium peer-checked:!text-echo">
                {t('settingsPage.systemTheme')}
              </span>
            </label>
          </div>
        </li>
        <li className="accent-color mb-2">
          <div className="description">{t('settingsPage.accentColorDescription')}</div>
          {/* Each swatch is the accent as this theme draws it, ringed by its echo (progress,
              links, focus): the two colours the choice actually changes. */}
          <div
            role="radiogroup"
            aria-label={t('settingsPage.accentColor')}
            className="flex flex-wrap items-center gap-3 pl-4 pt-4"
          >
            {ACCENT_PRESETS.map(({ id }) => {
              const tokens = accentTokens(id, isDarkMode ? 'dark' : 'light');
              const isOn = accent === id;
              const label = t(`settingsPage.accentColors.${id}`);
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isOn}
                  aria-label={label}
                  data-tooltip={label}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-on-accent outline-none transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo ${
                    isOn ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-1' : ''
                  }`}
                  style={{
                    backgroundColor: `rgb(${tokens.accent.join(' ')})`,
                    boxShadow: `inset 0 0 0 3px rgb(${tokens.echo.join(' ')})`
                  }}
                  onClick={() => storage.preferences.setPreferences('accentColor', id)}
                >
                  {isOn && <Icon name="check" size={18} />}
                </button>
              );
            })}
            <span className="ml-1 text-small text-ink-dim">
              {t(`settingsPage.accentColors.${accent}`)}
            </span>
          </div>
          {isDarkMode && (
            <>
              <div className="description mt-5">{t('settingsPage.frameShadeDescription')}</div>
              <div
                role="radiogroup"
                aria-label={t('settingsPage.frameShade')}
                className="flex flex-wrap items-center gap-3 pl-4 pt-4"
              >
                {FRAME_SHADES.map(({ id, rgb }) => {
                  const isOn = frameShade === id;
                  const label = t(`settingsPage.frameShades.${id}`);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={isOn}
                      aria-label={label}
                      data-tooltip={label}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border border-ink-faint/50 text-ink outline-none transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-echo ${
                        isOn ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-1' : ''
                      }`}
                      style={{ backgroundColor: `rgb(${rgb.join(' ')})` }}
                      onClick={() => storage.preferences.setPreferences('frameShade', id)}
                    >
                      {isOn && <Icon name="check" size={18} />}
                    </button>
                  );
                })}
                <span className="ml-1 text-small text-ink-dim">
                  {t(`settingsPage.frameShades.${frameShade}`)}
                </span>
              </div>
            </>
          )}
        </li>
        <li className="secondary-container enable-image-based-dynamic-themes mb-4">
          <div className="description">
            {t('settingsPage.enableImageBasedDynamicThemesDescription')}
          </div>
          <Checkbox
            id="toggleEnableImageBasedDynamicThemes"
            isChecked={!preferences?.isCoverLightDisabled}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('isCoverLightDisabled', !state)
            }
            labelContent={t('settingsPage.enableImageBasedDynamicThemes')}
          />
        </li>
        <li className="secondary-container visuals mb-4">
          <div className="description">
            <span className="font-semibold text-ink">{t('settingsPage.visuals')}</span>
            {'. '}
            {t('settingsPage.visualsDescription')}
          </div>
          {VISUALS.map(({ key, label }) => (
            <div key={key} className="mt-2">
              <Checkbox
                id={key}
                isChecked={!!preferences?.[key]}
                checkedStateUpdateFunction={(state) => storage.preferences.setPreferences(key, state)}
                labelContent={t(`settingsPage.${label}`)}
              />
              <div className="description ml-8 text-small text-ink-dim">
                {t(`settingsPage.${label}Description`)}
              </div>
            </div>
          ))}
        </li>
      </ul>
    </li>
  ) : null;
};

export default ThemeSettings;
