/**
 * Work the view buffers that must reach the core before a quit, a reload or a relaunch (the
 * persistence shadow's pending write, PLAN/21 P21.4): the runtime's `flush` awaits every hook. A
 * hook must bound its own wait: a restart awaits the flush without a timeout of its own.
 */
const flushHooks: (() => Promise<void>)[] = [];

export const registerFlush = (hook: () => Promise<void>): void => {
  flushHooks.push(hook);
};

export const runFlushHooks = async (): Promise<void> => {
  await Promise.all(
    flushHooks.map((hook) => hook().catch((error: unknown) => console.error('A flush before quitting failed.', error)))
  );
};
