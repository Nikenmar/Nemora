import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import storage from '../../../utils/localStorage';

import Checkbox from '../../Checkbox';
import LyricsLibrary from './LyricsLibrary';

const LyricsSettings = () => {
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
