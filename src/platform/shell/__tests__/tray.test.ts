import { describe, expect, test } from '@jest/globals';

import { TrayController, type ExitPort, type TrayFactory, type TrayHandle } from '../tray';
import { FakeWindow } from './fakes';

const createFactory = () => {
  const handlers: { onToggleVisibility?: () => void; onExit?: () => void } = {};
  let closed = 0;
  const handle: TrayHandle = {
    close: async () => {
      closed += 1;
    }
  };
  const factory: TrayFactory = {
    create: async (options) => {
      handlers.onToggleVisibility = options.onToggleVisibility;
      handlers.onExit = options.onExit;
      return handle;
    }
  };
  return { factory, handlers, closedCount: () => closed };
};

const createExitPort = (log: string[]): ExitPort => ({
  exit: async (code) => {
    log.push(`exit(${code})`);
  }
});

describe('TrayController', () => {
  test('writes the session before it kills the process', async () => {
    const log: string[] = [];
    const { factory } = createFactory();
    const controller = new TrayController(
      new FakeWindow(),
      factory,
      createExitPort(log),
      async () => {
        log.push('persist');
      }
    );

    await controller.start();
    await controller.exit();

    // Order is the whole point: Exit from the tray never touches the window, so
    // this hook is the only chance the renderer gets to write the playback
    // position and the repeat/shuffle state.
    expect(log).toEqual(['persist', 'exit(0)']);
  });

  test('still exits when persisting the session fails', async () => {
    const log: string[] = [];
    const { factory } = createFactory();
    const controller = new TrayController(new FakeWindow(), factory, createExitPort(log), () =>
      Promise.reject(new Error('store is unwritable'))
    );

    await controller.start();
    await controller.exit();

    // A player that refuses to quit because it cannot save is worse than one
    // that quits having lost the last position.
    expect(log).toEqual(['exit(0)']);
  });

  test('exits once even if the tray item is clicked twice', async () => {
    const log: string[] = [];
    const { factory, handlers } = createFactory();
    const controller = new TrayController(
      new FakeWindow(),
      factory,
      createExitPort(log),
      async () => {
        log.push('persist');
      }
    );

    await controller.start();
    handlers.onExit?.();
    handlers.onExit?.();
    await controller.exit();
    // The tray hands us a synchronous callback and the exit is asynchronous, so
    // the first click is still in flight here.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log.filter((entry) => entry === 'exit(0)')).toHaveLength(1);
    expect(log.filter((entry) => entry === 'persist')).toHaveLength(1);
  });
});
