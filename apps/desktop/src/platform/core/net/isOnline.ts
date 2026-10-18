/**
 * Online-state check for the ported network core.
 *
 * The Electron main process used `net.isOnline()`. A webview has no such API;
 * `navigator.onLine` is the closest signal and every network call already has
 * its own failure handling, so a wrong guess degrades to a failed request
 * rather than a crash. Non-browser environments (tests) report online so the
 * request-failure path decides.
 */
export const isConnectedToInternet = (): boolean =>
  typeof navigator === 'undefined' ? true : navigator.onLine;
