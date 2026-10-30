import { useContext, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import Checkbox from '../Checkbox';

import storage from '../../utils/localStorage';

const BlacklistSongConfrimPrompt = (props: { songIds: string[]; title?: string }) => {
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { songIds, title } = props;
  const [isDoNotShowAgain, setIsDoNotShowAgain] = useState(false);
  return (
    <>
      <div className="title-container mb-8 mt-1 flex items-center pr-4 text-title font-semibold text-ink">
        {t('blacklistSongConfirmPrompt.title', { count: songIds.length })}
      </div>
      <div className="description">
        {t('blacklistSongConfirmPrompt.message', { count: songIds.length })}
        <div className="mt-4">
          {t('blacklistSongConfirmPrompt.effectTitle')}
          <ul className="list-inside list-disc pl-4 marker:text-echo">
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect1"
                components={{
                  span: (
                    <span className="ms-icon text-echo">
                      block
                    </span>
                  )
                }}
              />
            </li>
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect2"
                components={{
                  span: (
                    <span className="text-echo" />
                  )
                }}
              />
            </li>
            <li>
              <Trans
                i18nKey="blacklistSongConfirmPrompt.effect3"
                components={{
                  span: (
                    <span className="text-echo" />
                  )
                }}
              />
            </li>
          </ul>
        </div>
      </div>
      <Checkbox
        id="doNotShowAgainCheckbox"
        className="no-blacklist-song-confirm-checkbox-container mt-8"
        labelContent={t('common.doNotShowThisMessageAgain')}
        isChecked={isDoNotShowAgain}
        checkedStateUpdateFunction={(state) => {
          setIsDoNotShowAgain(state);
        }}
      />
      <div className="buttons-container flex items-center justify-end">
        <Button
          label={t('song.blacklistSong', { count: songIds.length })}
          className="blacklist-song-btn mt-4 !bg-accent px-8 text-lg text-on-accent hover:border-accent "
          clickHandler={() =>
            window.api.audioLibraryControls
              .blacklistSongs(songIds)
              .then(() => {
                if (isDoNotShowAgain)
                  storage.preferences.setPreferences('isSongIndexingEnabled', isDoNotShowAgain);
                changePromptMenuData(false);
                return addNewNotifications([
                  {
                    id: `${title}Blacklisted`,
                    duration: 5000,
                    content: t('blacklistSongConfirmPrompt.songsBlacklisted', {
                      count: songIds.length
                    }),
                    iconName: 'delete_outline'
                  }
                ]);
              })
              .catch((err) => console.error(err))
          }
        />
      </div>
    </>
  );
};

export default BlacklistSongConfrimPrompt;
