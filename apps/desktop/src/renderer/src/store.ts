import { Store } from '@tanstack/store';
import {
  type AppReducerStateActions,
  DEFAULT_REDUCER_DATA,
  reducer as appReducer
} from './other/appReducer';
import storage from './utils/localStorage';

/**
 * The blob as the last session left it, before this one changes anything - before the check below,
 * which writes the defaults when there is none: what the persistence layer compares the core's
 * copy with, and restores from the core when it is missing (PLAN/21 P21.4). Read only.
 */
export const LOADED_LOCAL_STORAGE_TEXT = localStorage.getItem('localStorage');
storage.checkLocalStorage();
export const store = new Store(DEFAULT_REDUCER_DATA);

/**
 * A selector of only these preferences (PLAN/21 P21.3): a component re-renders when one of them
 * changes, not when any setting does. `useStore` compares the picked object shallowly.
 */
export const selectPreferences =
  <Key extends keyof Preferences>(...keys: Key[]) =>
  (state: typeof store.state): Pick<Preferences, Key> => {
    const preferences = state?.localStorage?.preferences;
    const picked = {} as Pick<Preferences, Key>;
    for (const key of keys) picked[key] = preferences?.[key];
    return picked;
  };

export const dispatch = (options: AppReducerStateActions) => {
  store.setState((state) => {
    return appReducer(state, options);
  });
};

export const reducer = () => {
  return { state: store.state, dispatch };
};

dispatch({
  type: 'UPDATE_LOCAL_STORAGE',
  data: storage.getLocalStorage()
});

store.subscribe(() => {
  storage.setLocalStorage(store.state.localStorage);
  if (window.api.properties.isInDevelopment) {
    console.debug('store state changed:', store.state);
  }
});
