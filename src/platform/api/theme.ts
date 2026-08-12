import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, type Theme } from '@tauri-apps/api/window';

import { getRuntime } from '../runtime';
import { emitLocal, subscribe, unsubscribe } from './events';

type ThemePayload = [isDarkMode: boolean, usingSystemTheme: boolean];
type ThemeCallback = (event: unknown, isDarkMode: boolean, usingSystemTheme: boolean) => void;
const appWindow = getCurrentWindow();
let systemThemeBridgeInstalled = false;

/** `--background-color-1` and `--dark-background-color-1`, resolved to hex. */
const WINDOW_BACKGROUNDS = { dark: '#212226', light: '#ffffff' } as const;

/**
 * Keeps the window and webview layers painted in the app's own background.
 *
 * These layers are not the page: they are what Windows shows while the webview
 * has not composited yet, which is why a launch flashed white and a fast resize
 * showed white along the edge being dragged. tauri.conf.json paints them dark
 * from the first frame; this follows the user's actual theme afterwards, so a
 * light-theme profile does not get a dark edge instead of a white one.
 */
const syncWindowBackground = (isDarkMode: boolean): void => {
  // Through the WEBVIEW window, not the plain window: the plain one colours the
  // window layer only, while this sets the window and the webview layer
  // together. The webview layer is the one exposed along the edge being
  // dragged, so colouring only the window still left a light sliver there.
  void getCurrentWebviewWindow()
    .setBackgroundColor(isDarkMode ? WINDOW_BACKGROUNDS.dark : WINDOW_BACKGROUNDS.light)
    .catch((error: unknown) => console.error('Failed to set the window background color.', error));
};

/** Applies the stored theme to the window layers once the profile is readable. */
export const startWindowBackgroundSync = (): void => {
  syncWindowBackground(getRuntime().getUserData().theme.isDarkMode);
};

const normalizeThemePayload = (
  payload: ThemePayload | { isDarkMode: boolean; usingSystemTheme: boolean }
): ThemePayload =>
  Array.isArray(payload) ? payload : [payload.isDarkMode, payload.usingSystemTheme];

export const theme = {
  listenForSystemThemeChanges: (callback: ThemeCallback): void => {
    subscribe('app/systemThemeChange', callback, normalizeThemePayload);
    if (!systemThemeBridgeInstalled) {
      systemThemeBridgeInstalled = true;
      void appWindow.onThemeChanged(({ payload }) => {
        const current = getRuntime().getUserData().theme;
        if (!current.useSystemTheme) return;
        const isDarkMode = payload === 'dark';
        getRuntime().saveUserData('theme', { isDarkMode, useSystemTheme: true });
        syncWindowBackground(isDarkMode);
        emitLocal('app/systemThemeChange', isDarkMode, true);
      });
    }
  },
  changeAppTheme: (appTheme?: AppTheme): void => {
    const runtime = getRuntime();
    const windowTheme: Theme | null = appTheme === 'system' ? null : (appTheme ?? null);
    void appWindow.setTheme(windowTheme);
    const mediaDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkMode =
      appTheme === undefined
        ? !runtime.getUserData().theme.isDarkMode
        : appTheme === 'dark' || (appTheme === 'system' && mediaDark);
    const useSystemTheme = appTheme === 'system';
    runtime.saveUserData('theme', { isDarkMode, useSystemTheme });
    syncWindowBackground(isDarkMode);
    emitLocal('app/systemThemeChange', isDarkMode, useSystemTheme);
  },
  stoplisteningForSystemThemeChanges: (callback: ThemeCallback): void =>
    unsubscribe('app/systemThemeChange', callback)
};
