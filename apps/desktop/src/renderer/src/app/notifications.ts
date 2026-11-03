// PLAN/21 P21.5: moved from App.tsx as it was. Adding and updating the notifications on screen;
// App calls the hook where the two callbacks were, so the hooks keep their order.
import { type TransitionStartFunction, useCallback } from 'react';

import { dispatch, store } from '../store';

export const useNotifications = (startTransition: TransitionStartFunction) => {
  /**
   * A notification that is already on screen is updated WHERE IT IS.
   *
   * It used to be removed and unshifted back to the front, so every update
   * moved it to the top of the list. With one notification that is a no-op;
   * with two live progress bars they swapped places several times a second, and
   * each swap moves the DOM node, which restarts its entrance animation. The
   * bars looked like they were being recreated. Order is now decided once, when
   * a notification first appears; only genuinely new ones go to the front.
   */
  const addNewNotifications = useCallback((newNotifications: AppNotification[]) => {
    if (newNotifications.length > 0) {
      const maxNotifications = 4;
      const current = store.state.notificationPanelData.notifications;
      const replacements = new Map(newNotifications.map((x) => [x.id, x]));
      const updated = current.map((existing) => replacements.get(existing.id) ?? existing);
      const known = new Set(current.map((x) => x.id));
      const fresh = newNotifications.filter((x) => !known.has(x.id));
      const resultNotifications = [...fresh, ...updated].slice(0, maxNotifications);

      startTransition(() =>
        dispatch({
          type: 'ADD_NEW_NOTIFICATIONS',
          data: resultNotifications
        })
      );
    }
    // startTransition is useTransition's, stable for App's life; [] as it was in App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateNotifications = useCallback(
    (callback: (currentNotifications: AppNotification[]) => AppNotification[]) => {
      const currentNotifications = store.state.notificationPanelData.notifications;
      const updatedNotifications = callback(currentNotifications);

      dispatch({ type: 'UPDATE_NOTIFICATIONS', data: updatedNotifications });
    },
    []
  );

  return { addNewNotifications, updateNotifications };
};
