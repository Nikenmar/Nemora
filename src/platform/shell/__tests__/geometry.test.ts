import {
  DISPLAY_CHANGED_EVENT,
  WindowGeometryController,
  type GeometryRepository
} from '../geometry';
import type { PhysicalRect } from '../types';
import { FakeEvents, FakeWindow } from './fakes';

const savedRect: PhysicalRect = { x: -1928, y: 100, width: 1280, height: 700 };

const createRepository = () => {
  const writes: Array<{ mode: 'normal' | 'mini'; rect: PhysicalRect }> = [];
  const values: Partial<Record<'normal' | 'mini', PhysicalRect>> = { normal: savedRect };
  const repository: GeometryRepository = {
    load: (mode) => values[mode],
    save: (mode, rect) => {
      values[mode] = rect;
      writes.push({ mode, rect });
    },
    miniPlayerAlwaysOnTop: () => true
  };
  return { repository, values, writes };
};

describe('WindowGeometryController', () => {
  test('clamps the observed -1928/-1920 overhang before restoring it', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, writes } = createRepository();
    const invoked: PhysicalRect[] = [];
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const rect = args?.rect as PhysicalRect;
          invoked.push(rect);
          return { ...rect, x: -1920 } as T;
        }
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );

    await controller.restore('normal');

    expect(invoked).toEqual([savedRect]);
    expect(window.setRects).toEqual([{ ...savedRect, x: -1920 }]);
    expect(writes).toEqual([{ mode: 'normal', rect: { ...savedRect, x: -1920 } }]);
  });

  test('reclamps after the native display-change event', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository } = createRepository();
    let clampCount = 0;
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          clampCount += 1;
          return args?.rect as T;
        }
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );
    await controller.start();

    events.emit(DISPLAY_CHANGED_EVENT, undefined);
    // A macrotask, not a fixed number of microtask ticks: the reclamp queries
    // the window before it clamps, so counting ticks makes the test fail on a
    // change in how many awaits precede the invoke.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clampCount).toBe(1);
    controller.stop();
  });

  test('switches the same window into mini mode, clamps, and reapplies topmost state', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, values } = createRepository();
    values.mini = { x: 20, y: 30, width: 400, height: 240 };
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> =>
          args?.rect as T
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );

    await controller.changeMode('mini');

    expect(window.fullscreen).toEqual([false]);
    expect(window.limits.at(-1)).toEqual([270, 200, 510, 300]);
    expect(window.alwaysOnTop.at(-1)).toBe(true);
    expect(window.rect).toEqual(values.mini);
  });

  test('does not persist the rectangle a minimized window reports', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, writes, values } = createRepository();
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> =>
          args?.rect as T
      },
      events,
      repository,
      { settle: () => Promise.resolve(), debounceMs: 0 }
    );
    await controller.start();

    // What Windows answers for a minimized window: parked at -32000 and shrunk
    // to the iconic box. tao forwards the move and the resize like any other.
    window.minimized = true;
    window.rect = { x: -32000, y: -32000, width: 160, height: 31 };
    window.emitMoved();
    window.emitResized();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(writes).toEqual([]);
    expect(values.normal).toEqual(savedRect);
    controller.stop();
  });

  test('restores a profile that already holds a minimized rectangle at a usable size', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, values } = createRepository();
    values.normal = { x: -32000, y: -32000, width: 160, height: 31 };
    const clamped: PhysicalRect[] = [];
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const rect = args?.rect as PhysicalRect;
          clamped.push(rect);
          // What the native clamp does with an off-screen rectangle: the
          // nearest work area, size preserved.
          return { ...rect, x: 0, y: 0 } as T;
        }
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );

    await controller.restore('normal');

    expect(clamped).toEqual([{ x: -32000, y: -32000, width: 700, height: 500 }]);
    expect(window.rect).toEqual({ x: 0, y: 0, width: 700, height: 500 });
  });

  test('leaves the saved rectangle alone when a display changes while minimized', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, writes } = createRepository();
    let clampCount = 0;
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          clampCount += 1;
          return args?.rect as T;
        }
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );
    await controller.start();

    window.minimized = true;
    window.rect = { x: -32000, y: -32000, width: 160, height: 31 };
    events.emit(DISPLAY_CHANGED_EVENT, undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clampCount).toBe(0);
    expect(writes).toEqual([]);
    expect(window.setRects).toEqual([]);
    controller.stop();
  });

  test('clamps and persists the windowed rectangle before entering fullscreen', async () => {
    const window = new FakeWindow();
    const events = new FakeEvents();
    const { repository, writes } = createRepository();
    const controller = new WindowGeometryController(
      window,
      {
        invoke: async <T>(_command: string, args?: Record<string, unknown>): Promise<T> => {
          const rect = args?.rect as PhysicalRect;
          return { ...rect, x: -1920 } as T;
        }
      },
      events,
      repository,
      { settle: () => Promise.resolve() }
    );

    await controller.changeMode('full');

    expect(window.setRects.at(-1)?.x).toBe(-1920);
    expect(writes.at(-1)).toEqual({
      mode: 'normal',
      rect: { ...savedRect, x: -1920 }
    });
    expect(window.fullscreen.at(-1)).toBe(true);
  });
});
