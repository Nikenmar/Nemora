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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

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
