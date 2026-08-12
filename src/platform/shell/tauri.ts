import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { stat } from '@tauri-apps/plugin-fs';
import { exit } from '@tauri-apps/plugin-process';

import type { FileArgumentPort } from './singleInstance';
import type { ExitPort, TrayFactory, TrayHandle } from './tray';
import type {
  InvokePort,
  NativeTheme,
  PhysicalRect,
  ShellEventPort,
  Unlisten,
  WindowPort
} from './types';

const window = getCurrentWindow();

export const tauriInvokePort: InvokePort = {
  invoke: (command, args) => invoke(command, args)
};

export const tauriEventPort: ShellEventPort = {
  listen: async <T>(event: string, handler: (payload: T) => void): Promise<Unlisten> =>
    listen<T>(event, ({ payload }) => handler(payload))
};

export const tauriWindowPort: WindowPort = {
  outerRect: async () => {
    const [position, size] = await Promise.all([window.outerPosition(), window.outerSize()]);
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  },
  setRect: async (rect: PhysicalRect) => {
    await window.setSize(new PhysicalSize(rect.width, rect.height));
    await window.setPosition(new PhysicalPosition(rect.x, rect.y));
  },
  setSizeLimits: async (minWidth, minHeight, maxWidth, maxHeight) => {
    await window.setMinSize(new PhysicalSize(minWidth, minHeight));
    await window.setMaxSize(new PhysicalSize(maxWidth, maxHeight));
  },
  center: () => window.center(),
  setFullscreen: (fullscreen) => window.setFullscreen(fullscreen),
  setAlwaysOnTop: (alwaysOnTop) => window.setAlwaysOnTop(alwaysOnTop),
  minimize: () => window.minimize(),
  maximize: () => window.maximize(),
  unmaximize: () => window.unmaximize(),
  isMaximized: () => window.isMaximized(),
  isMinimized: () => window.isMinimized(),
  unminimize: () => window.unminimize(),
  isVisible: () => window.isVisible(),
  show: () => window.show(),
  hide: () => window.hide(),
  focus: () => window.setFocus(),
  close: () => window.close(),
  startDragging: () => window.startDragging(),
  theme: async () => (await window.theme()) as NativeTheme | null,
  setBackgroundColor: (color) => window.setBackgroundColor(color),
  onMoved: (handler) => window.onMoved(handler),
  onResized: (handler) => window.onResized(handler),
  onScaleChanged: (handler) => window.onScaleChanged(handler),
  onThemeChanged: (handler) => window.onThemeChanged(({ payload }) => handler(payload))
};

export const tauriTrayFactory: TrayFactory = {
  create: async (options): Promise<TrayHandle> => {
    const menu = await Menu.new({
      items: [
        {
          id: 'nora-show-hide',
          text: 'Show/Hide Nemora',
          action: options.onToggleVisibility
        },
        { item: 'Separator' },
        { id: 'nora-exit', text: 'Exit', action: options.onExit }
      ]
    });
    const tray = await TrayIcon.new({
      id: 'nora-tray',
      icon: (await defaultWindowIcon()) ?? undefined,
      menu,
      tooltip: options.tooltip,
      showMenuOnLeftClick: true,
      action: (event) => {
        if (event.type === 'DoubleClick' && event.button === 'Left') {
          options.onToggleVisibility();
        }
      }
    });
    return {
      close: async () => {
        await tray.close();
        await menu.close();
      }
    };
  }
};

export const tauriExitPort: ExitPort = { exit };

export const tauriFileArgumentPort: FileArgumentPort = {
  isFile: async (path) => {
    try {
      return (await stat(path)).isFile;
    } catch {
      return false;
    }
  }
};
