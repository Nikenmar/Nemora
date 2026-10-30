import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../Dropdown';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import i18n, { supportedLanguagesDropdownOptions } from '../../../i18n';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const LanguageSettings = () => {
  const { t } = useTranslation();
  const userData = useStore(store, (state) => state.userData);

  const { addNewNotifications } = useContext(AppUpdateContext);
  const appLang = userData?.language || 'en';

  return (
    <li className="main-container performance-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2 leading-none">translate</span>
        <span>{t('settingsPage.language')}</span>
      </div>
      <ul className="list-disc pl-6 marker:bg-accent">
        <li className="seekbar-scroll-interval mb-4">
          <div className="description">{t('settingsPage.languageDescription')}</div>
          <Dropdown
            className="mt-4"
            name="supportedLanguagesDropdown"
            value={appLang}
            options={supportedLanguagesDropdownOptions}
            onChange={(e) => {
              const val = e.currentTarget.value as LanguageCodes;

              i18n.reloadResources();
              // if (i18n.languages.includes(val))
              return i18n
                .changeLanguage(val, (err) => {
                  if (err) return console.warn(err);
                  window.api.userData.saveUserData('language', val);
                  return window.api.appControls.restartRenderer(`App language changed to ${val}`);
                })
                .then(() =>
                  addNewNotifications([
                    {
                      id: 'languageChanged',
                      content: t('notifications.languageChanged'),
                      iconName: 'translate'
                    }
                  ])
                );
              // return console.error(`App doesn't support the selected language '${val}'`, {
              //   supportedLanguages: i18n.languages
              // });
            }}
          />
        </li>
      </ul>
    </li>
  );
};

export default LanguageSettings;
