import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';

const NotificationClearAllButton = () => {
  const { updateNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  return (
    <Button
      label={t('notifications.clearAll')}
      key="ClearAllBtn"
      clickHandler={() => updateNotifications(() => [])}
      size="sm"
      className="notification appear-from-bottom !mr-0 mt-3 border border-glass-border !bg-surface-3 shadow-float first:mt-0"
      iconName="close"
    />
  );
};

export default NotificationClearAllButton;
