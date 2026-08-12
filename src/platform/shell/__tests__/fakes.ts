import type { NativeTheme, PhysicalRect, ShellEventPort, Unlisten, WindowPort } from '../types';

export class FakeWindow implements WindowPort {
  rect: PhysicalRect = { x: -1928, y: 100, width: 1280, height: 700 };
  setRects: PhysicalRect[] = [];
  limits: number[][] = [];
  alwaysOnTop: boolean[] = [];
  fullscreen: boolean[] = [];
  visible = true;
  minimized = false;
  maximized = false;
  focused = 0;
  private moved: (() => void) | undefined;
  private resized: (() => void) | undefined;
  private scaled: (() => void) | undefined;
  private themed: ((theme: NativeTheme) => void) | undefined;

  outerRect(): Promise<PhysicalRect> {
    return Promise.resolve({ ...this.rect });
  }

  setRect(rect: PhysicalRect): Promise<void> {
    this.rect = { ...rect };
    this.setRects.push({ ...rect });
    return Promise.resolve();
  }

  setSizeLimits(...limits: number[]): Promise<void> {
    this.limits.push(limits);
    return Promise.resolve();
  }

  center(): Promise<void> {
    this.rect = { ...this.rect, x: 320, y: 180 };
    return Promise.resolve();
  }

  setFullscreen(value: boolean): Promise<void> {
    this.fullscreen.push(value);
    return Promise.resolve();
  }

  setAlwaysOnTop(value: boolean): Promise<void> {
    this.alwaysOnTop.push(value);
    return Promise.resolve();
  }

  minimize(): Promise<void> {
    this.minimized = true;
    return Promise.resolve();
  }

  maximize(): Promise<void> {
    this.maximized = true;
    return Promise.resolve();
  }

  unmaximize(): Promise<void> {
    this.maximized = false;
    return Promise.resolve();
  }

  isMaximized(): Promise<boolean> {
    return Promise.resolve(this.maximized);
  }

  isMinimized(): Promise<boolean> {
    return Promise.resolve(this.minimized);
  }

  unminimize(): Promise<void> {
    this.minimized = false;
    return Promise.resolve();
  }

  isVisible(): Promise<boolean> {
    return Promise.resolve(this.visible);
  }

  show(): Promise<void> {
    this.visible = true;
    return Promise.resolve();
  }

  hide(): Promise<void> {
    this.visible = false;
    return Promise.resolve();
  }

  focus(): Promise<void> {
    this.focused += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  startDragging(): Promise<void> {
    return Promise.resolve();
  }

  theme(): Promise<NativeTheme> {
    return Promise.resolve('light');
  }

  setBackgroundColor(): Promise<void> {
    return Promise.resolve();
  }

  onMoved(handler: () => void): Promise<Unlisten> {
    this.moved = handler;
    return Promise.resolve(() => {
      this.moved = undefined;
    });
  }

  onResized(handler: () => void): Promise<Unlisten> {
    this.resized = handler;
    return Promise.resolve(() => {
      this.resized = undefined;
    });
  }

  onScaleChanged(handler: () => void): Promise<Unlisten> {
    this.scaled = handler;
    return Promise.resolve(() => {
      this.scaled = undefined;
    });
  }

  onThemeChanged(handler: (theme: NativeTheme) => void): Promise<Unlisten> {
    this.themed = handler;
    return Promise.resolve(() => {
      this.themed = undefined;
    });
  }

  emitMoved(): void {
    this.moved?.();
  }

  emitResized(): void {
    this.resized?.();
  }

  emitScaleChanged(): void {
    this.scaled?.();
  }
}

export class FakeEvents implements ShellEventPort {
  readonly handlers = new Map<string, (payload: unknown) => void>();

  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
    this.handlers.set(event, handler as (payload: unknown) => void);
    return Promise.resolve(() => this.handlers.delete(event));
  }

  emit<T>(event: string, payload: T): void {
    this.handlers.get(event)?.(payload);
  }
}
