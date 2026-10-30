import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import storage from '../../utils/localStorage';
import debounce from '../../utils/debounce';

import Checkbox from '../Checkbox';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const LyricsEditorSettingsPrompt = () => {
  const lyricsEditorSettings = useStore(store, (state) => state.localStorage.lyricsEditorSettings);
  const { t } = useTranslation();

  const [offset, setOffset] = useState(lyricsEditorSettings.offset || 0);

  return (
    <div>
      <div className="title-container mb-4 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2 text-4xl">settings</span>{' '}
        {t('lyricsEditorSettingsPrompt.lyricsEditorSettings')}
      </div>
      <ul className="list-disc pl-6 marker:bg-echo">
        <li className="secondary-container show-remaining-song-duration mb-4">
          <p className="description">
            {t(
              'lyricsEditorSettingsPrompt.editNextAndCurrentStartAndEndTagsAutomaticallyDescription'
            )}
          </p>
          <Checkbox
            id="editNextAndCurrentStartAndEndTagsAutomatically"
            isChecked={lyricsEditorSettings.editNextAndCurrentStartAndEndTagsAutomatically}
            checkedStateUpdateFunction={(state) =>
              storage.lyricsEditorSettings.setLyricsEditorSettings(
                'editNextAndCurrentStartAndEndTagsAutomatically',
                state
              )
            }
            labelContent={t(
              'lyricsEditorSettingsPrompt.editNextAndCurrentStartAndEndTagsAutomatically'
            )}
          />
        </li>
        <li className="secondary-container mb-4">
          <p className="description">
            {t('lyricsEditorSettingsPrompt.lyricOffsetInputDescription')}
          </p>
          <input
            type="number"
            id="lyric-offset-input"
            className="ml-2 mt-2 w-[90%] max-w-xs rounded-3xl border-[.15rem] border-surface-2 bg-surface-2 px-4 py-2 text-ink transition-colors focus:border-echo "
            name="offset"
            placeholder={t('lyricsEditorSettingsPrompt.lyricOffsetInput')}
            value={offset}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const newOffset = e.currentTarget.valueAsNumber;
              setOffset(newOffset);
              debounce(() => {
                storage.lyricsEditorSettings.setLyricsEditorSettings('offset', newOffset);
              }, 250);
            }}
          />
        </li>
      </ul>
    </div>
  );
};

export default LyricsEditorSettingsPrompt;
