/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import storage from '../../../utils/localStorage';

import ThemePreview from '../../ui/ThemePreview';

import Checkbox from '../../Checkbox';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const ThemeSettings = () => {
  const userData = useStore(store, (state) => state.userData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

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
      </ul>
    </li>
  ) : null;
};

export default ThemeSettings;
