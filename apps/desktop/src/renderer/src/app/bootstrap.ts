// PLAN/21 P21.5: moved from App.tsx as it was. What App's module did once, when first loaded:
// the player and its sound, the playback recovery ledger, the network status and the user data.
// App imports this last, so it runs after every other module App loads, as it did in App's body.
import AudioPlayer from '../other/player';
import { registerSoundPlayer } from '../other/soundEffects';
import { applySavedCorrection } from '../other/headphoneCorrection';
import { setPlaybackClock } from '../other/trackVisuals';
import { PlaybackRecoveryLedger } from '../other/playbackRecovery';
import { dispatch } from '../store';

// ? CONSTANTS
export const LOW_RESPONSE_DURATION = 100;
export const DURATION = 1000;

// ? INITIALIZE PLAYER
export const player = new AudioPlayer();
// Slowed & reverb (PLAN/18): the saved sound applies from the start.
registerSoundPlayer(player);
// Headphone correction (PLAN/18 D5), when the user turned it on.
applySavedCorrection();
setPlaybackClock(() => player.currentTime);
/**
 * What has already been tried for the track that is failing right now.
 *
 * Cleared whenever a track actually plays, which is the point the previous
 * counter got wrong: it only ever incremented, so a session long enough to
 * collect six unrelated hiccups answered every later one with an error dialog.
 */
export const playbackRecovery = new PlaybackRecoveryLedger();

// ? / / / / / / /  PLAYER DEFAULT OPTIONS / / / / / / / / / / / / / /
// player.addEventListener('player/trackchange', (e) => {
//   if ('detail' in e) {
//     console.log(`player track changed to ${(e as DetailAvailableEvent<string>).detail}.`);
//   }
// });
// / / / / / / / /

const updateNetworkStatus = () => window.api.settingsHelpers.networkStatusChange(navigator.onLine);
export const syncUserData = () =>
  window.api.userData
    .getUserData()
    .then((res) => {
      if (!res) return undefined;

      dispatch({ type: 'USER_DATA_CHANGE', data: res });
      dispatch({ type: 'APP_THEME_CHANGE', data: res.theme });
      return res;
    })
    .catch((err) => console.error(err));

updateNetworkStatus();
syncUserData();
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
