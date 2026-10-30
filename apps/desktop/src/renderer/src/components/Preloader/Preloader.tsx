import { useEffect, useState } from 'react';

import Img from '../Img';

import AppIcon from '../../assets/images/webp/logo_light_mode.webp';

/**
 * The logo screen shown while the app assembles itself.
 *
 * It used to outlive its purpose by seconds. Two things kept it up:
 *
 * 1. It hid one second after `window.load` - but the listener was registered
 *    when this module was evaluated, which under Tauri happens AFTER
 *    `hydrateRuntime()` has finished reading the profile. By then `load` has
 *    usually already fired, so the listener never ran and the only thing left
 *    was the five-second safety timeout. Under Electron the preload made
 *    `window.api` available up front, the bundle ran early, and the listener
 *    was in place before `load` - which is why the same code felt slower here
 *    than in the Electron build.
 * 2. The transition carried `delay-700`, adding another 0.7 s on top.
 *
 * Nothing was ever waiting for data: the stores are hydrated before React
 * mounts, so by the time this renders the app IS ready. It now hides on the
 * frame after mount, and `document.readyState` is checked instead of assuming
 * an event is still to come.
 */
const SAFETY_TIMEOUT_MS = 5000;

const Preloader = () => {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;

    // Two frames: one to let this paint, one to let the app paint behind it.
    // Hiding inside the same frame trades a stale logo for a blank window.
    const hide = (): void => {
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setIsHidden(true));
      });
    };

    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide, { once: true });

    // Still a floor, not a schedule: it only matters if a frame never arrives.
    const safety = setTimeout(() => setIsHidden(true), SAFETY_TIMEOUT_MS);

    return () => {
      window.removeEventListener('load', hide);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(safety);
    };
  }, []);

  if (isHidden) return null;

  return (
    <div className="preloader visible absolute z-40 flex h-full w-full items-center justify-center bg-canvas opacity-100 transition-[visibility,opacity] duration-300">
      <Img
        src={AppIcon}
        className="h-14 w-14 animate-[appearFromBottom_400ms_var(--ease-out)_forwards] rounded-[14px] opacity-0"
        loading="eager"
      />
    </div>
  );
};

export default Preloader;
