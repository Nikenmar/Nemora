import { subscribeNoPayload, unsubscribe } from './events';

type QuitCallback = (event: unknown) => void;

export const quitEvent = {
  beforeQuitEvent: (callback: QuitCallback): void =>
    subscribeNoPayload('app/beforeQuitEvent', callback),
  removeBeforeQuitEventListener: (callback: QuitCallback): void =>
    unsubscribe('app/beforeQuitEvent', callback)
};
