import { useTranslation } from 'react-i18next';
import storage from '../../../utils/localStorage';
import Checkbox from '../../Checkbox';
import { useStore } from '@tanstack/react-store';
import { store, selectPreferences } from '@renderer/store';

const AccessibilitySettings = () => {
  const preferences = useStore(store, selectPreferences('isReducedMotion'));
  const { t } = useTranslation();

  return (
    <li className="main-container accessibility-settings-container mb-16">
      <div className="title-container mb-4 mt-1 flex items-center text-title font-semibold text-ink">
        <span className="ms-icon mr-2">settings_accessibility</span>
        {t('settingsPage.accessibility')}
      </div>
      <ul className="list-disc pl-6 marker:bg-accent">
        <li className="secondary-container toggle-reduced-motion mb-4">
          <div className="description">{t('settingsPage.reducedMotionDescription')}</div>
          <Checkbox
            id="enableReducedMotion"
            labelContent={t('settingsPage.enableReducedMotion')}
            isChecked={preferences?.isReducedMotion}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('isReducedMotion', state)
            }
          />
        </li>
      </ul>
    </li>
  );
};

export default AccessibilitySettings;
