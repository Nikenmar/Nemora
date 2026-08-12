import type {
  InvokePort,
  PhysicalRect,
  ShellEventPort,
  Unlisten,
  WindowMode,
  WindowPort
} from './types';

export const WINDOW_LIMITS = {
  normal: { minWidth: 700, minHeight: 500, maxWidth: 10_000, maxHeight: 5_000 },
  mini: { minWidth: 270, minHeight: 200, maxWidth: 510, maxHeight: 300 }
} as const;

export const DEFAULT_WINDOW_RECTS = {
  normal: { x: 0, y: 0, width: 1280, height: 720 },
  mini: { x: 0, y: 0, width: 270, height: 200 }
} as const satisfies Record<'normal' | 'mini', PhysicalRect>;

export const DISPLAY_CHANGED_EVENT = 'nemora://display-changed';

export interface GeometryRepository {
  load(mode: Exclude<WindowMode, 'full'>): PhysicalRect | undefined;
  save(mode: Exclude<WindowMode, 'full'>, rect: PhysicalRect): void | Promise<void>;
  miniPlayerAlwaysOnTop(): boolean;
}

export interface GeometryOptions {
  settle?: () => Promise<void>;
  debounceMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const defaultSettle = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const storedMode = (mode: WindowMode): Exclude<WindowMode, 'full'> | undefined =>
  mode === 'full' ? undefined : mode;

export class WindowGeometryController {
  private readonly window: WindowPort;
  private readonly commands: InvokePort;
  private readonly events: ShellEventPort;
  private readonly repository: GeometryRepository;
  private readonly settle: () => Promise<void>;
  private readonly debounceMs: number;
  private readonly setTimer: NonNullable<GeometryOptions['setTimer']>;
  private readonly clearTimer: NonNullable<GeometryOptions['clearTimer']>;
  private mode: WindowMode = 'normal';
  private applying = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private operation = Promise.resolve();
  private unlisten: Unlisten[] = [];

  constructor(
    window: WindowPort,
    commands: InvokePort,
    events: ShellEventPort,
    repository: GeometryRepository,
    options: GeometryOptions = {}
  ) {
    this.window = window;
    this.commands = commands;
    this.events = events;
    this.repository = repository;
    this.settle = options.settle ?? defaultSettle;
    this.debounceMs = options.debounceMs ?? 150;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  async start(): Promise<void> {
    const listeners = await Promise.all([
      this.window.onMoved(() => this.schedulePersist()),
      this.window.onResized(() => this.schedulePersist()),
      this.window.onScaleChanged(() => void this.reclamp()),
      this.events.listen<unknown>(DISPLAY_CHANGED_EVENT, () => void this.reclamp())
    ]);
    this.unlisten.push(...listeners);
  }

  stop(): void {
    for (const unlisten of this.unlisten.splice(0)) unlisten();
    if (this.persistTimer) this.clearTimer(this.persistTimer);
    this.persistTimer = undefined;
  }

  restore(mode: Exclude<WindowMode, 'full'> = 'normal'): Promise<void> {
    return this.enqueue(async () => {
      this.mode = mode;
      this.applying = true;
      try {
        await this.window.setFullscreen(false);
        await this.applyModeLimits(mode);
        await this.window.setAlwaysOnTop(
          mode === 'mini' && this.repository.miniPlayerAlwaysOnTop()
        );
        const saved = this.repository.load(mode);
        if (saved) await this.applyClampedWithinTransition(saved);
        else {
          const fallback = DEFAULT_WINDOW_RECTS[mode];
          const current = await this.window.outerRect();
          await this.window.setRect({ ...fallback, x: current.x, y: current.y });
          await this.window.center();
        }
        await this.settle();
        await this.repository.save(mode, await this.window.outerRect());
      } finally {
        this.applying = false;
      }
    });
  }

  changeMode(mode: WindowMode): Promise<void> {
    return this.enqueue(async () => {
      this.cancelPendingPersist();
      if (mode === 'full') {
        this.applying = true;
        try {
          const previousMode = storedMode(this.mode);
          if (previousMode) {
            await this.applyClampedWithinTransition(await this.window.outerRect());
            await this.settle();
            await this.repository.save(previousMode, await this.window.outerRect());
          }
          this.mode = mode;
          await this.window.setAlwaysOnTop(false);
          await this.window.setFullscreen(true);
          await this.settle();
        } finally {
          this.applying = false;
        }
        return;
      }

      this.mode = mode;
      this.applying = true;
      try {
        await this.window.setFullscreen(false);
        await this.applyModeLimits(mode);
        await this.window.setAlwaysOnTop(
          mode === 'mini' && this.repository.miniPlayerAlwaysOnTop()
        );
        const saved = this.repository.load(mode);
        if (saved) await this.applyClampedWithinTransition(saved);
        else {
          const fallback = DEFAULT_WINDOW_RECTS[mode];
          const current = await this.window.outerRect();
          await this.applyClampedWithinTransition({ ...fallback, x: current.x, y: current.y });
          await this.window.center();
        }
        await this.settle();
        await this.repository.save(mode, await this.window.outerRect());
      } finally {
        this.applying = false;
      }
    });
  }

  reclamp(): Promise<void> {
    return this.enqueue(async () => {
      const mode = storedMode(this.mode);
      if (!mode) return;
      this.cancelPendingPersist();
      await this.applyClamped(await this.window.outerRect());
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.operation.then(operation, operation);
    this.operation = queued.catch(() => undefined);
    return queued;
  }

  private async applyModeLimits(mode: Exclude<WindowMode, 'full'>): Promise<void> {
    const limits = WINDOW_LIMITS[mode];
    await this.window.setSizeLimits(
      limits.minWidth,
      limits.minHeight,
      limits.maxWidth,
      limits.maxHeight
    );
  }

  private async clamp(rect: PhysicalRect): Promise<PhysicalRect> {
    return this.commands.invoke<PhysicalRect>('clamp_rect_to_single_monitor', { rect });
  }

  private async applyClamped(rect: PhysicalRect): Promise<void> {
    const mode = storedMode(this.mode);
    if (!mode) return;
    this.applying = true;
    try {
      await this.applyClampedWithinTransition(rect);
      await this.settle();
      await this.repository.save(mode, await this.window.outerRect());
    } finally {
      this.applying = false;
    }
  }

  private async applyClampedWithinTransition(rect: PhysicalRect): Promise<void> {
    const clamped = await this.clamp(rect);
    // The adapter applies physical size before physical position. This order is
    // required for mixed-DPI restores and avoids a transient cross-monitor rect.
    await this.window.setRect(clamped);
  }

  private schedulePersist(): void {
    if (this.applying || this.mode === 'full') return;
    this.cancelPendingPersist();
    this.persistTimer = this.setTimer(() => {
      this.persistTimer = undefined;
      void this.persistCurrent();
    }, this.debounceMs);
  }

  private cancelPendingPersist(): void {
    if (this.persistTimer) this.clearTimer(this.persistTimer);
    this.persistTimer = undefined;
  }

  private async persistCurrent(): Promise<void> {
    const mode = storedMode(this.mode);
    if (!mode || this.applying) return;
    await this.repository.save(mode, await this.window.outerRect());
  }
}
