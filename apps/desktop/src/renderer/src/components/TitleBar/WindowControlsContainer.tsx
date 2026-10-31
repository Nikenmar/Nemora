import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '../ui/Icon';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { cn } from '../ui/cn';

/** A 46 px zone, as Windows draws its own caption buttons. */
const zone =
  'flex h-full w-[46px] items-center justify-center text-ink-dim outline-none transition-colors duration-100 focus-visible:bg-surface-2 focus-visible:text-ink';

const WindowControlsContainer = () => {
  const userData = useStore(store, (state) => state.userData);

  const { t } = useTranslation();

  const close = useCallback(() => {
    if (userData && userData.preferences.hideWindowOnClose) window.api.windowControls.hideApp();
    else window.api.windowControls.closeApp();
  }, [userData]);

  const minimize = useCallback(() => window.api.windowControls.minimizeApp(), []);
  const maximize = useCallback(() => window.api.windowControls.toggleMaximizeApp(), []);

  return (
    <div className="window-controls-container flex h-full items-stretch" id="window-controls-container">
      <button
        type="button"
        className={cn('minimize-btn', zone, 'hover:bg-surface-2 hover:text-ink')}
        onClick={minimize}
        aria-label={t('titleBar.minimize')}
      >
        <Icon name="remove" size={18} />
      </button>
      <button
        type="button"
        className={cn('maximize-btn', zone, 'hover:bg-surface-2 hover:text-ink')}
        onClick={maximize}
        aria-label={t('titleBar.maximize')}
      >
        <Icon name="crop_square" size={16} />
      </button>
      <button
        type="button"
        className={cn('close-btn', zone, 'hover:bg-danger hover:text-on-accent')}
        onClick={close}
        aria-label={t('titleBar.close')}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
};

export default WindowControlsContainer;
