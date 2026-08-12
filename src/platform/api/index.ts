import { albumsData } from './albums-data';
import { appControls } from './app-controls';
import { artistsData } from './artists-data';
import { audioLibraryControls } from './audio-library-controls';
import { battery } from './battery';
import { dataUpdates } from './data-updates';
import { eloDuels } from './elo-duels';
import { folderData } from './folder-data';
import { fullscreen } from './fullscreen';
import { genresData } from './genres-data';
import { log } from './log';
import { lyrics } from './lyrics';
import { messages } from './messages';
import { miniPlayer } from './mini-player';
import { noraImport } from './nora-import';
import { playerControls } from './player-controls';
import { playlistsData } from './playlists-data';
import { properties } from './properties';
import { quitEvent } from './quit-event';
import { search } from './search';
import { settingsHelpers } from './settings-helpers';
import { songDataFromInternet } from './song-data-from-internet';
import { songGuessr } from './song-guessr';
import { songUpdates } from './song-updates';
import { statsData } from './stats-data';
import { storageData } from './storage-data';
import { suggestions } from './suggestions';
import { theme } from './theme';
import { tierlistsData } from './tierlists-data';
import { unknownSource } from './unknown-source';
import { userData } from './user-data';
import { utils } from './utils';
import { windowControls } from './window-controls';
import { hydrateRuntime } from '../runtime';

export { emitLocal } from './events';
export { NotPortedYetError } from './errors';
// Startup wiring the renderer bootstrap must call once, after the runtime is
// hydrated. Both exist because the modules behind them were written and then
// never constructed by anything.
export { startTaskbarButtons } from './taskbar-buttons';
export { startWindowGeometry } from './window-controls';
export { startWindowBackgroundSync } from './theme';
export type { PathBackedAudioPlayerData, PathBackedUpdateSongDataResult } from './binary';

export const api = {
  properties,
  windowControls,
  theme,
  playerControls,
  audioLibraryControls,
  suggestions,
  unknownSource,
  quitEvent,
  battery,
  fullscreen,
  search,
  lyrics,
  messages,
  dataUpdates,
  songUpdates,
  songDataFromInternet,
  userData,
  storageData,
  folderData,
  artistsData,
  genresData,
  albumsData,
  playlistsData,
  tierlistsData,
  statsData,
  eloDuels,
  songGuessr,
  log,
  miniPlayer,
  noraImport,
  settingsHelpers,
  appControls,
  utils
};

export type NoraApi = typeof api;

export const installApi = (): NoraApi => {
  const existing = Object.getOwnPropertyDescriptor(window, 'api');
  if (existing?.value === api) return api;
  if (existing && !existing.configurable) {
    throw new Error('window.api is already installed and cannot be replaced.');
  }

  Object.defineProperty(window, 'api', {
    value: api,
    configurable: false,
    enumerable: true,
    writable: false
  });
  return api;
};

export const bootstrapApi = async (): Promise<NoraApi> => {
  await hydrateRuntime();
  return installApi();
};
