import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';

import Checkbox from '../../Checkbox';

import LastFMIcon from '../../../assets/images/webp/last-fm-logo.webp';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const AccountsSettings = () => {
  const userData = useStore(store, (state) => state.userData);
  const { updateUserData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const isLastFmConnected = useMemo(
    () => !!userData?.lastFmSessionData,
    [userData?.lastFmSessionData]
  );

  return (
    <li className="main-container startup-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-2xl font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
        <span className="material-icons-round-outlined mr-2">account_circle</span>
        {t('settingsPage.accounts')}
      </div>
      <ul className="list-disc pl-6 marker:bg-background-color-3 dark:marker:bg-background-color-3">
        <li className="discord-rpc-integration mb-4">
          <div className="description">{t('settingsPage.enableDiscordRpcDescription')}</div>
          <Checkbox
            id="enableDiscordRpc"
            isChecked={userData?.preferences.enableDiscordRPC ?? false}
            checkedStateUpdateFunction={(state) =>
              window.api.userData
                .saveUserData('preferences.enableDiscordRPC', state)
                .then(() =>
                  updateUserData((prevData) => ({
                    ...prevData,
                    preferences: {
                      ...prevData.preferences,
                      enableDiscordRPC: state
                    }
                  }))
                )
                .catch((err) => console.error(err))
            }
            labelContent={t('settingsPage.enableDiscordRpc')}
          />
        </li>
        {/*
          Last.fm is hidden unless a session already exists (one imported from a
          Nora profile, say). Nothing here is deleted: the API, the scrobbler and
          the session handling all stay, and showing this block again is a matter
          of dropping this condition. What is gone is the way IN - the browser
          login button - because the callback it depends on cannot come back to
          the app: `nemora://` is not registered with Windows as a protocol
          handler, so the browser has nowhere to return the token to. Offering a
          login that cannot complete is worse than not offering one.
        */}
        {isLastFmConnected && (
          <li className="last-fm-integration mb-4">
            <div className="description">{t('settingsPage.integrateLastFm')}</div>
            <div className="flex p-4 pb-0">
              <img
                src={LastFMIcon}
                alt={t('settingsPage.lastFmLogo')}
                className={`mr-4 h-16 w-16 rounded-md ${
                  !isLastFmConnected && 'brightness-90 grayscale'
                }`}
              />
              <div className="flex-grow-0">
                <p
                  className={`flex items-center font-semibold uppercase ${
                    isLastFmConnected ? 'text-green-500' : 'text-red-500'
                  } `}
                >
                  {t(
                    isLastFmConnected
                      ? 'settingsPage.lastFmConnected'
                      : 'settingsPage.lastFmNotConnected'
                  )}{' '}
                  {isLastFmConnected &&
                    userData?.lastFmSessionData &&
                    `(${t('settingsPage.loggedInAs')} ${userData.lastFmSessionData.name})`}
                </p>
                <ul className="list-inside list-disc text-sm">
                  <li>{t('settingsPage.lastFmDescription1')}</li>
                  <li>{t('settingsPage.lastFmDescription2')}</li>
                  <li>{t('settingsPage.lastFmDescription3')}</li>
                  <li>{t('settingsPage.lastFmDescription4')}</li>
                </ul>
              </div>
            </div>
            <ul className="mt-4 list-disc pl-8 marker:bg-background-color-3 dark:marker:bg-background-color-3">
              <li
                className={`last-fm-integration mb-4 transition-opacity ${
                  !isLastFmConnected && 'cursor-not-allowed opacity-50'
                }`}
              >
                <div className="description">{t('settingsPage.scrobblingDescription')}</div>
                <Checkbox
                  id="sendSongScrobblingDataToLastFM"
                  isChecked={!!userData?.preferences.sendSongScrobblingDataToLastFM}
                  checkedStateUpdateFunction={(state) =>
                    window.api.userData
                      .saveUserData('preferences.sendSongScrobblingDataToLastFM', state)
                      .then(() =>
                        updateUserData((prevUserData) => ({
                          ...prevUserData,
                          preferences: {
                            ...prevUserData.preferences,
                            sendSongScrobblingDataToLastFM: state
                          }
                        }))
                      )
                  }
                  labelContent={t('settingsPage.enableScrobbling')}
                  isDisabled={!isLastFmConnected}
                />
              </li>
              <li
                className={`last-fm-integration mb-4 transition-opacity ${
                  !isLastFmConnected && 'cursor-not-allowed opacity-50'
                }`}
              >
                <div className="description">
                  {t('settingsPage.sendFavoritesToLastFmDescription')}
                </div>
                <Checkbox
                  id="sendSongFavoritesDataToLastFM"
                  isChecked={!!userData?.preferences.sendSongFavoritesDataToLastFM}
                  checkedStateUpdateFunction={(state) =>
                    window.api.userData
                      .saveUserData('preferences.sendSongFavoritesDataToLastFM', state)
                      .then(() =>
                        updateUserData((prevUserData) => ({
                          ...prevUserData,
                          preferences: {
                            ...prevUserData.preferences,
                            sendSongFavoritesDataToLastFM: state
                          }
                        }))
                      )
                  }
                  labelContent={t('settingsPage.sendFavoritesToLastFm')}
                  isDisabled={!isLastFmConnected}
                />
              </li>
              <li
                className={`last-fm-integration mb-4 transition-opacity ${
                  !isLastFmConnected && 'cursor-not-allowed opacity-50'
                }`}
              >
                <div className="description">
                  {t('settingsPage.sendNowPlayingToLastFmDescription')}
                </div>
                <Checkbox
                  id="sendNowPlayingSongDataToLastFM"
                  isChecked={!!userData?.preferences.sendNowPlayingSongDataToLastFM}
                  checkedStateUpdateFunction={(state) =>
                    window.api.userData
                      .saveUserData('preferences.sendNowPlayingSongDataToLastFM', state)
                      .then(() =>
                        updateUserData((prevUserData) => ({
                          ...prevUserData,
                          preferences: {
                            ...prevUserData.preferences,
                            sendNowPlayingSongDataToLastFM: state
                          }
                        }))
                      )
                  }
                  labelContent={t('settingsPage.sendNowPlayingToLastFm')}
                  isDisabled={!isLastFmConnected}
                />
              </li>
            </ul>
          </li>
        )}
      </ul>
    </li>
  );
};

export default AccountsSettings;
