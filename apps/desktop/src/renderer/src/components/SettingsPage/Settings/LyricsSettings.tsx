import { lazy, useContext, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import storage from '../../../utils/localStorage';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';

import Button from '../../Button';
import Checkbox from '../../Checkbox';
import LyricsLibrary from './LyricsLibrary';

import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const MusixmatchSettingsPrompt = lazy(() => import('../MusixmatchSettingsPrompt'));
const MusixmatchDisclaimerPrompt = lazy(() => import('../MusixmatchDisclaimerPrompt'));

const LyricsSettings = () => {
  const userData = useStore(store, (state) => state.userData);

  const { changePromptMenuData, updateUserData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [autoTranslateLyrics, setAutoTranslateLyrics] = useState(false);

  useEffect(() => {
    const autoTranslateLyrics = storage.preferences.getPreferences('autoTranslateLyrics');

    setAutoTranslateLyrics(autoTranslateLyrics);
  }, []);

  const [autoConvertLyrics, setAutoConvertLyrics] = useState(false);

  useEffect(() => {
    const autoConvertLyrics = storage.preferences.getPreferences('autoConvertLyrics');

    setAutoConvertLyrics(autoConvertLyrics);
  }, []);

  return (
    <li className="main-container audio-playback-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">notes</span>
        {t('settingsPage.lyrics')}
      </div>
      <ul className="list-disc pl-6 marker:bg-echo">
        <li className="secondary-container enable-musixmatch-lyrics mb-4">
          <div className="description">
            {t('settingsPage.enableMusixmatchLyricsDescription')}
            <div className="ml-2 mt-1 text-sm font-light">
              <Trans
                i18nKey="settingsPage.musixmatchDisclaimerNotice"
                components={{
                  Button: (
                    <Button
                      className="!m-0 !inline !rounded-none !border-0 !bg-transparent !p-0 px-2 !text-echo outline-1 outline-offset-1 hover:underline focus-visible:!outline"
                      clickHandler={() => {
                        changePromptMenuData(true, <MusixmatchDisclaimerPrompt />);
                      }}
                    />
                  )
                }}
              />
            </div>
          </div>
          <div className="mt-4 flex">
            {userData?.preferences.isMusixmatchLyricsEnabled && (
              <Button
                label={t('settingsPage.editMusixmatchSettings')}
                iconName="settings"
                clickHandler={() =>
                  changePromptMenuData(
                    true,
                    <MusixmatchSettingsPrompt />,
                    'edit-musixmatch-settings'
                  )
                }
              />
            )}
            <Button
              label={
                userData?.preferences.isMusixmatchLyricsEnabled
                  ? t('settingsPage.musixmatchEnabled')
                  : t('settingsPage.enableMusixmatch')
              }
              iconName={userData?.preferences.isMusixmatchLyricsEnabled ? 'done' : undefined}
              clickHandler={() => {
                const state = !userData?.preferences.isMusixmatchLyricsEnabled;
                window.api.userData
                  .saveUserData('preferences.isMusixmatchLyricsEnabled', state)
                  .then(() =>
                    updateUserData((prevData) => ({
                      ...prevData,
                      preferences: {
                        ...prevData.preferences,
                        isMusixmatchLyricsEnabled: state
                      }
                    }))
                  )
                  .catch((err) => console.error(err));
              }}
              isDisabled={userData?.preferences.isMusixmatchLyricsEnabled}
            />
          </div>
        </li>

        <li className="secondary-container auto-translate-lyrics mb-4">
          <div className="description">{t('settingsPage.autoTranslateLyricsDescription')}</div>
          <Checkbox
            id="autoTranslateLyrics"
            isChecked={autoTranslateLyrics}
            checkedStateUpdateFunction={(state) => {
              setAutoTranslateLyrics(state);
              storage.preferences.setPreferences('autoTranslateLyrics', state);
            }}
            labelContent={t('settingsPage.autoTranslateLyrics')}
          />
        </li>

        <LyricsLibrary />

        <li className="secondary-container auto-convert-lyrics mb-4">
          <div className="description">{t('settingsPage.autoConvertLyricsDescription')}</div>
          <Checkbox
            id="autoConvertLyrics"
            isChecked={autoConvertLyrics}
            checkedStateUpdateFunction={(state) => {
              setAutoConvertLyrics(state);
              storage.preferences.setPreferences('autoConvertLyrics', state);
            }}
            labelContent={t('settingsPage.autoConvertLyrics')}
          />
        </li>
      </ul>
    </li>
  );
};

export default LyricsSettings;
