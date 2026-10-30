import ErrorBoundary from '../ErrorBoundary';
import CurrentlyPlayingSongInfoContainer from './CurrentlyPlayingSongInfoContainer';
import OtherSongControlsContainer from './OtherSongControlsContainer';
import SongControlsAndSeekbarContainer from './SongControlsAndSeekbarContainer';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const SongControlsContainer = () => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  return (
    <footer
      className={`song-controls-container relative bottom-0 z-20 grid h-[76px] w-full shrink-0 grid-cols-[minmax(0,1fr)_minmax(20rem,40rem)_minmax(0,1fr)] items-center gap-4 border-t border-line text-ink sm:gap-2 ${
        bodyBackgroundImage ? 'bg-surface-1/70 backdrop-blur-md' : 'bg-surface-1'
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
