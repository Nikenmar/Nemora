import ErrorBoundary from '../ErrorBoundary';
import CurrentlyPlayingSongInfoContainer from './CurrentlyPlayingSongInfoContainer';
import OtherSongControlsContainer from './OtherSongControlsContainer';
import SongControlsAndSeekbarContainer from './SongControlsAndSeekbarContainer';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const SongControlsContainer = () => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  return (
    // The middle column is as wide as the seek row (36rem) and no wider, and in a narrow window gives
    // way down to 20rem: the song's title and Up next reach right up to the time instead of stopping
    // at empty columns either side of the seek row.
    <footer
      className={`song-controls-container relative bottom-0 z-20 grid h-[76px] w-full shrink-0 grid-cols-[minmax(0,1fr)_minmax(20rem,min(36rem,44%))_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-center gap-4 text-ink sm:gap-2 ${
        bodyBackgroundImage ? 'bg-chrome/70 backdrop-blur-md' : 'bg-chrome'
      } bg-[linear-gradient(90deg,color-mix(in_srgb,var(--cover-glow)_var(--cover-glow-strength),transparent),transparent_46%)]`}
    >
      <ErrorBoundary>
        <>
          <CurrentlyPlayingSongInfoContainer />
          <SongControlsAndSeekbarContainer />
          <OtherSongControlsContainer />
        </>
      </ErrorBoundary>
    </footer>
  );
};

SongControlsContainer.displayName = 'SongControlsContainer';
export default SongControlsContainer;
