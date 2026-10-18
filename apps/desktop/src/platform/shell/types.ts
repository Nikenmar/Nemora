export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowMode = 'normal' | 'mini' | 'full';
export type NativeTheme = 'light' | 'dark';

export type Unlisten = () => void;

export interface ShellEventPort {
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>;
}

export interface WindowPort {
  outerRect(): Promise<PhysicalRect>;
  setRect(rect: PhysicalRect): Promise<void>;
  setSizeLimits(
    minWidth: number,
    minHeight: number,
    maxWidth: number,
    maxHeight: number
  ): Promise<void>;
  center(): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  unminimize(): Promise<void>;
  isVisible(): Promise<boolean>;
  show(): Promise<void>;
  hide(): Promise<void>;
  focus(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  theme(): Promise<NativeTheme | null>;
  setBackgroundColor(color: string): Promise<void>;
  onMoved(handler: () => void): Promise<Unlisten>;
  onResized(handler: () => void): Promise<Unlisten>;
  onScaleChanged(handler: () => void): Promise<Unlisten>;
  onThemeChanged(handler: (theme: NativeTheme) => void): Promise<Unlisten>;
}

export interface InvokePort {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
