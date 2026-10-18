import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type LegacyEvent = undefined;
export type LegacyListener<Args extends unknown[]> = (event: LegacyEvent, ...args: Args) => void;

interface ListenerRegistration {
  callback: Function;
  removed: boolean;
  unlisten: Promise<UnlistenFn>;
}

const registrations = new Map<string, ListenerRegistration[]>();
const localListeners = new Map<string, Function[]>();

const reportSubscriptionError = (eventName: string, error: unknown): void => {
  console.error(`Unable to subscribe to Tauri event "${eventName}".`, error);
};

export const subscribe = <Payload, Args extends unknown[]>(
  eventName: string,
  callback: LegacyListener<Args>,
  toArgs: (payload: Payload) => Args
): void => {
  const erasedCallback = callback as Function;
  const channelLocalListeners = localListeners.get(eventName) ?? [];
  channelLocalListeners.push(erasedCallback);
  localListeners.set(eventName, channelLocalListeners);

  const registration: ListenerRegistration = {
    callback: erasedCallback,
    removed: false,
    unlisten: Promise.resolve(() => undefined)
  };
  registration.unlisten = listen<Payload>(eventName, ({ payload }) => {
    if (!registration.removed) callback(undefined, ...toArgs(payload));
  });
  registration.unlisten
    .then((unlisten) => {
      if (registration.removed) unlisten();
    })
    .catch((error: unknown) => reportSubscriptionError(eventName, error));

  const channelRegistrations = registrations.get(eventName) ?? [];
  channelRegistrations.push(registration);
  registrations.set(eventName, channelRegistrations);
};

export const subscribeNoPayload = (eventName: string, callback: LegacyListener<[]>): void =>
  subscribe<unknown, []>(eventName, callback, () => []);

export const unsubscribe = (eventName: string, callback: Function): void => {
  const channelRegistrations = registrations.get(eventName);
  if (channelRegistrations) {
    let index = -1;
    for (let candidate = channelRegistrations.length - 1; candidate >= 0; candidate -= 1) {
      const registration = channelRegistrations[candidate];
      if (registration.callback === callback && !registration.removed) {
        index = candidate;
        break;
      }
    }
    if (index >= 0) {
      const [registration] = channelRegistrations.splice(index, 1);
      registration.removed = true;
      void registration.unlisten.then((unlisten) => unlisten()).catch(() => undefined);
    }
    if (channelRegistrations.length === 0) registrations.delete(eventName);
  }

  const channelLocalListeners = localListeners.get(eventName);
  if (channelLocalListeners) {
    const index = channelLocalListeners.lastIndexOf(callback);
    if (index >= 0) channelLocalListeners.splice(index, 1);
    if (channelLocalListeners.length === 0) localListeners.delete(eventName);
  }
};

export const unsubscribeAll = (eventName: string): void => {
  const channelRegistrations = registrations.get(eventName) ?? [];
  registrations.delete(eventName);
  localListeners.delete(eventName);
  for (const registration of channelRegistrations) {
    registration.removed = true;
    void registration.unlisten.then((unlisten) => unlisten()).catch(() => undefined);
  }
};

export const emitLocal = <Args extends unknown[]>(eventName: string, ...args: Args): void => {
  for (const callback of [...(localListeners.get(eventName) ?? [])]) {
    (callback as LegacyListener<Args>)(undefined, ...args);
  }
};

export const tuplePayload = <Args extends unknown[]>(payload: Args): Args => payload;
export const scalarPayload = <Value>(payload: Value): [Value] => [payload];
