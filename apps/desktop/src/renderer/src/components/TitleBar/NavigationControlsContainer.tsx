import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { cn } from '../ui/cn';

type Props = { disableHomeButton?: boolean };

/** Back and forward through the pages; each shows only while it leads somewhere. */
const NavigationControlsContainer = (props: Props) => {
  const navigationHistory = useStore(store, (state) => state.navigationHistory);

  const pageHistoryIndex = navigationHistory.pageHistoryIndex;
  const noOfPagesInHistory = navigationHistory.history.length - 1;

  const { updatePageHistoryIndex } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { disableHomeButton = false } = props;
  const canGoBack = pageHistoryIndex > 0;
  const canGoForward = noOfPagesInHistory !== 0 && pageHistoryIndex < noOfPagesInHistory;
  const look = '!mr-0 !h-7 !w-7 transition-[background-color,color,transform,visibility,opacity]';

  return (
    <div className="navigation-controls-container flex w-fit shrink-0 items-center gap-0.5">
      <Button
        iconName="arrow_back"
        className={cn(
          'previousPageBtn',
          look,
          canGoBack ? 'available visible opacity-100' : 'invisible -translate-x-1 opacity-0'
        )}
        clickHandler={() => updatePageHistoryIndex('decrement')}
        tooltipLabel={t('titleBar.goBack')}
      />

      {!disableHomeButton && (
        <Button
          iconName="home"
          className={cn(
            'goToHomePageBtn',
            look,
            noOfPagesInHistory > 0 ? 'available visible opacity-100' : 'invisible opacity-0'
          )}
          clickHandler={() => updatePageHistoryIndex('home')}
          tooltipLabel={t('titleBar.goHome')}
        />
      )}

      <Button
        iconName="arrow_forward"
        className={cn(
          'forwardPageBtn',
          look,
          canGoForward ? 'available visible opacity-100' : 'invisible translate-x-1 opacity-0'
        )}
        clickHandler={() => updatePageHistoryIndex('increment')}
        tooltipLabel={t('titleBar.goForward')}
      />
    </div>
  );
};

export default NavigationControlsContainer;
