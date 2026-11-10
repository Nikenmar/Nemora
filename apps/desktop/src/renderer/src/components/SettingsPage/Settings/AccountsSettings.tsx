import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';

import Checkbox from '../../Checkbox';

import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const AccountsSettings = () => {
  const userData = useStore(store, (state) => state.userData);
  const { updateUserData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  return (
    <li className="main-container startup-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">account_circle</span>
        {t('settingsPage.accounts')}
      </div>
      <ul className="list-disc pl-6 marker:bg-accent">
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
        <li className="obs-widget-integration mb-4">
          <div className="description">{t('settingsPage.enableObsWidgetDescription')}</div>
          <Checkbox
            id="enableObsWidget"
            isChecked={userData?.preferences.enableObsWidget ?? false}
            checkedStateUpdateFunction={(state) =>
              window.api.userData
                .saveUserData('preferences.enableObsWidget', state)
                .then(() =>
                  updateUserData((prevData) => ({
                    ...prevData,
                    preferences: {
                      ...prevData.preferences,
                      enableObsWidget: state
                    }
                  }))
                )
                .catch((err) => console.error(err))
            }
            labelContent={t('settingsPage.enableObsWidget')}
          />
        </li>
      </ul>
    </li>
  );
};

export default AccountsSettings;
