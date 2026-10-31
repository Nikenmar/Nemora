import { useTranslation } from 'react-i18next';

import Button from '../../Button';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const ChangeThemeBtn = () => {
  const isDarkMode = useStore(store, (state) => state.isDarkMode);
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  const { t } = useTranslation();

  return (
    <Button
      className={`change-theme-btn !mr-1 flex cursor-pointer items-center justify-center rounded-md !border-0 bg-transparent !px-3 !py-1 text-center text-xl outline-1 outline-offset-1 transition-[color,background] ease-in-out hover:bg-surface-2 hover:text-echo focus-visible:!outline ${
        bodyBackgroundImage && '!text-on-media hover:!text-echo'
      }`}
      clickHandler={() => window.api.theme.changeAppTheme()}
      tooltipLabel={t('titleBar.changeTheme')}
      iconName={isDarkMode ? 'wb_sunny' : 'dark_mode'}
      iconClassName="ms-icon icon text-center text-xl leading-none transition-[background] ease-in-out"
    />
  );
};

export default ChangeThemeBtn;
