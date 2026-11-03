// PLAN/21 P21.5: moved from App.tsx as it was. The prompts and screens App opens, loaded when first shown.
import { lazy } from 'react';

// ? PROMPTS
export const UnsupportedFileMessagePrompt = lazy(
  () => import('../components/UnsupportedFileMessagePrompt')
);
export const SongUnplayableErrorPrompt = lazy(() => import('../components/SongUnplayableErrorPrompt'));
export const AppShortcutsPrompt = lazy(() => import('../components/SettingsPage/AppShortcutsPrompt'));

// ? SCREENS
export const MiniPlayer = lazy(() => import('../components/MiniPlayer/MiniPlayer'));
export const FullScreenPlayer = lazy(() => import('../components/FullScreenPlayer/FullScreenPlayer'));
