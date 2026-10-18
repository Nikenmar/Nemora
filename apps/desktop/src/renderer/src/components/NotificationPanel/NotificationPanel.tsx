import { useMemo } from 'react';
import Notification from './Notification';
import NotificationClearAllButton from './NotificationClearAllButton';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const NotificationPanel = () => {
  const notificationPanelData = useStore(store, (state) => state.notificationPanelData);

  const notifications = useMemo(() => {
    const notificationData = notificationPanelData.notifications;

    if (notificationData.length > 0) {
      // Reversed HERE, once, rather than at render time.
      //
      // The reversal used to happen in the JSX, on the array this memo hands
      // back - so it mutated the cached value, and every re-render that did not
      // change the notifications flipped the order again. With one notification
      // on screen that was invisible. With two, they swapped places constantly,
      // and each swap moves the DOM node, which restarts its entrance
      // animation: the notification looked like it was being recreated over and
      // over. Two simultaneous progress bars is what finally exposed it.
      return notificationData.map((data) => {
        const {
          content,
          duration,
          id,
          buttons,
          icon,
          iconName,
          iconClassName,
          order,
          progressBarData,
          type
        } = data;
        return (
          <Notification
            key={id}
            id={id}
            content={content}
            buttons={buttons}
            icon={icon}
            iconName={iconName}
            iconClassName={iconClassName}
            duration={duration}
            order={order}
            type={type}
            progressBarData={progressBarData}
          />
        );
      }).reverse();
    }
    return undefined;
  }, [notificationPanelData]);

  return (
    <>
      {Array.isArray(notifications) && notifications.length > 0 && (
        <div className="notifications-container absolute bottom-6 right-8 z-20 flex max-h-full flex-col-reverse items-end">
          {notifications}
          {notifications.length > 0 && <NotificationClearAllButton />}
        </div>
      )}
    </>
  );
};

NotificationPanel.displayName = 'NotificationPanel';
export default NotificationPanel;
