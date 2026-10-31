import { memo } from 'react';

import { version } from '../../../../../package.json';

import Img from '../Img';
import NetworkIndicator from './indicators/NetworkIndicator';
import ChangeThemeBtn from './special_controls/ChangeThemeBtn';
import NavigationControlsContainer from './NavigationControlsContainer';
import WindowControlsContainer from './WindowControlsContainer';
import TitleBarSearch from './TitleBarSearch';

import AppLogo from '../../assets/images/webp/logo_light_mode.webp';
import GoToMainPlayerBtn from './special_controls/GoToMainPlayerBtn';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store';
import { cn } from '../ui/cn';

/** `2.1.0-stable` reads as `v2.1.0`: the build, not its channel. */
const buildVersion = version.split('-')[0];

/**
 * The bar over the whole window: the mark and back/forward over the sidebar, the search field in the
 * middle, indicators and the window buttons on the right. The window drags by it (styles.css).
 */
const TitleBar = memo(() => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const playerType = useStore(store, (state) => state.playerType);

  return (
    <header
      id="title-bar"
      className={cn(
        'relative top-0 z-40 grid h-12 w-full shrink-0 grid-cols-[216px_minmax(0,1fr)_auto] items-center overflow-hidden bg-chrome text-ink',
        playerType === 'full' && 'bg-transparent',
        bodyBackgroundImage && 'bg-canvas/60 backdrop-blur-md'
      )}
    >
      <div className="logo-and-app-name-container flex h-full items-center gap-2.5 pl-4">
        {/* The app icon whole, white tile and all (no rounding that clips it); then the build's version. */}
        <Img className="h-[22px] w-[22px]" src={AppLogo} alt="" />
        <span className="app-version flex items-start gap-1 text-section font-semibold">
          Nemora
          <span className="pt-px text-[10px] font-semibold leading-none tracking-wide text-ink-faint">
            v{buildVersion}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3 pl-3">
        {playerType !== 'full' && <NavigationControlsContainer disableHomeButton />}
        {playerType !== 'full' && <TitleBarSearch />}
      </div>
      <div className="window-controls-and-special-controls-and-indicators-container flex h-full flex-row items-center">
        <div className="special-controls-and-indicators-container mr-1 flex items-center gap-1 text-ink-dim">
          <div className="indicators-container flex flex-row">
            <NetworkIndicator />
          </div>
          <div className="special-controls-container flex flex-row">
            {window.api.properties.isInDevelopment && <ChangeThemeBtn />}
            {playerType === 'full' && <GoToMainPlayerBtn />}
          </div>
        </div>
        <WindowControlsContainer />
      </div>
    </header>
  );
});

TitleBar.displayName = 'TitleBar';
export default TitleBar;
