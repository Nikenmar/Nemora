import { scalarPayload, subscribe, unsubscribeAll } from './events';

export const dataUpdates = {
  dataUpdateEvent: (callback: (event: unknown, dataEvents: DataUpdateEvent[]) => void): void =>
    subscribe('app/dataUpdateEvent', callback, scalarPayload<DataUpdateEvent[]>),
  removeDataUpdateEventListeners: (): void => unsubscribeAll('app/dataUpdateEvent')
};
