import { invoke } from '@tauri-apps/api/core';

/**
 * The one place that knows what the Windows taskbar thumbbar should show.
 *
 * It exists because the state was previously assembled at two call sites
 * (the startup seed and every play/pause), each recomputing `isDarkMode` at the
 * moment it fired. Nothing recomputed it when Windows actually switched theme,
 * so the native light/dark icons kept whatever they were given last and only
 * corrected themselves the next time playback toggled. Keeping the state here
 * means a theme change can re-push it without inventing a playback state.
 */
let isPlaying = false;

const prefersDark = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

const push = (): void => {
  void invoke('set_taskbar_buttons', {
    state: {
      isPlaying,
      hasPrevious: true,
      hasNext: true,
      isPlaybackSupported: true,
      isDarkMode: prefersDark()?.matches ?? false
    }
  }).catch((error: unknown) => console.error('Failed to update taskbar playback buttons.', error));
};

let themeListenerInstalled = false;

/**
 * Seeds the buttons and keeps their icons following the system theme.
 *
 * Called once during startup: Windows draws nothing until it is told what the
 * buttons are, so without the seed the thumbbar stayed empty until the first
 * play/pause.
 */
export const startTaskbarButtons = (): void => {
  if (!themeListenerInstalled) {
    themeListenerInstalled = true;
    prefersDark()?.addEventListener('change', () => push());
  }
  push();
};

/** Reports the current playback state; also re-pushes the theme-dependent icons. */
export const setTaskbarPlaybackState = (playing: boolean): void => {
  isPlaying = playing;
  push();
};
