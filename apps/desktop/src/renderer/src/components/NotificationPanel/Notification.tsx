import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties
} from 'react';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import { useStore } from '@tanstack/react-store';
import { store, selectPreferences } from '@renderer/store';

const Notification = (props: AppNotification) => {
  const {
    id,
    content,
    duration = 5000,
    buttons,
    icon,
    iconName = 'info',
    iconClassName,
    type = 'DEFAULT',
    progressBarData = { total: 100, value: 50 }
  } = props;
  const preferences = useStore(store, selectPreferences('isReducedMotion'));
  const { updateNotifications } = useContext(AppUpdateContext);

  const notificationRef = useRef(null as HTMLDivElement | null);
  const notificationTimeoutIdRef = useRef(undefined as ReturnType<typeof setTimeout> | undefined);

  const notificationPanelStyles: CSSProperties = {};
  notificationPanelStyles['--loading-bar-progress'] =
    `${(progressBarData.value / progressBarData.total) * 100}%`;
  notificationPanelStyles['--notification-duration'] = `${duration}ms`;

  const removeNotification = useCallback(() => {
    const isNotificationAnimationDisabled =
      preferences?.isReducedMotion || type === 'WITH_PROGRESS_BAR';

    if (notificationTimeoutIdRef.current) clearTimeout(notificationTimeoutIdRef.current);

    if (notificationRef.current && !isNotificationAnimationDisabled) {
      notificationRef.current.classList.add('disappear-to-bottom');
      notificationRef.current.addEventListener(
        'animationend',
        () =>
          updateNotifications((currNotifications) => currNotifications.filter((x) => x.id !== id)),
        { once: true }
      );
    } else updateNotifications((currNotifications) => currNotifications.filter((x) => x.id !== id));
  }, [id, preferences?.isReducedMotion, type, updateNotifications]);

  // The countdown restarts on every progress update.
  //
  // Without `progressBarData.value` in the deps the timer was set once, so a
  // process that ran longer than the notification's duration had its own
  // progress bar disappear out from under it - and the next update put it back,
  // which read as the notification flickering rather than as one that had
  // expired. Measuring the duration from the LAST update means the bar stays
  // for as long as there is something to report, and no longer.
  useLayoutEffect(() => {
    const notification = notificationRef.current;
    if (notification) {
      notificationTimeoutIdRef.current = setTimeout(removeNotification, duration);
    }

    return () => {
      if (notificationTimeoutIdRef.current) clearTimeout(notificationTimeoutIdRef.current);
      if (notification?.classList.contains('disappear-to-bottom')) {
        clearTimeout(notificationTimeoutIdRef.current);
        updateNotifications((currNotifications) => currNotifications.filter((x) => x.id !== id));
      }
    };
  }, [duration, id, progressBarData.value, removeNotification, updateNotifications]);

  const notificationIcon = useMemo(() => {
    if (icon) return icon;
    if (iconName)
      return (
        <span
          className={`text-[18px] text-echo ${iconClassName ?? 'ms-icon'}`}
        >
          {iconName}
        </span>
      );
    return undefined;
  }, [icon, iconClassName, iconName]);

  return (
    <div
      className="notification appear-from-bottom group relative mt-2 flex h-fit max-h-32 min-h-[44px] w-fit min-w-[16rem] max-w-md justify-between overflow-hidden rounded-menu border border-glass-border bg-surface-3 text-body text-ink shadow-float transition-[opacity,transform,visibility] ease-out first-of-type:mt-2"
      id="notificationPanelsContainer"
      ref={notificationRef}
      style={notificationPanelStyles}
    >
      <div
        className={`progress-bar-container absolute bottom-0 left-0 h-[2px] w-full overflow-hidden before:absolute before:h-full before:w-0 before:bg-echo before:opacity-0 before:transition-[opacity,width] before:content-[''] ${
          type === 'WITH_PROGRESS_BAR' &&
          progressBarData &&
          progressBarData.total !== progressBarData.value &&
          `before:!w-[var(--loading-bar-progress,0%)] before:!opacity-100`
        } ${
          type !== 'WITH_PROGRESS_BAR' ||
          (type === 'WITH_PROGRESS_BAR' && progressBarData.total === progressBarData.value)
            ? `before:!animate-[widthFillAnimation_var(--notification-duration)_linear] before:!opacity-30`
            : 'before:!animate-none'
        }`}
      />
      <div className="close-button-container absolute right-1.5 top-1.5 z-[1] opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <span
          className="ms-icon icon flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-[16px] text-ink-dim hover:bg-glass-hover hover:text-ink"
          aria-label="Dismiss"
          onClick={removeNotification}
          onKeyDown={removeNotification}
          role="button"
          tabIndex={0}
        >
          close
        </span>
      </div>
      <div
        className={`notification-info-and-buttons-container flex w-full flex-col py-2.5 pl-3.5 pr-9 ${
          !(Array.isArray(buttons) && buttons.length > 0) && 'justify-center'
        }`}
      >
        <div className="notification-info-container flex flex-row items-center gap-3">
          <div className="icon-container relative flex h-6 w-fit items-center justify-center [&>img]:aspect-square [&>img]:h-4">
            {notificationIcon}
          </div>
          <div className="message-container overflow-hidden text-ellipsis py-0.5 leading-snug">
            {content}
          </div>
        </div>
        {Array.isArray(buttons) && buttons.length > 0 && (
          <div className="buttons-container flex justify-end">
            {buttons.map((button) => (
              <Button
                key={`notificationPanelButton-${button.label}`}
                label={button.label}
                iconName={button.iconName}
                iconClassName={button.iconClassName}
                size="sm"
                className={`mb-0.5 ml-2 mr-0 mt-2 ${button.className}`}
                clickHandler={(e, setIsDisabled, setIsPending) => {
                  removeNotification();
                  button.clickHandler(e, setIsDisabled, setIsPending);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

Notification.displayName = 'Notification';
export default Notification;
