import type { ObsWidgetState, ObsWidgetUpNext } from '@platform/api';
import { store } from '../store';

/**
 * Feeds the OBS widget from the renderer store.
 *
 * It lives here, and not in `@platform/api`, for the same reason the taskbar
 * buttons are driven from the renderer: the platform layer has no store, and
 * the shape the widget shows - a joined artist line, the "+N" the UP NEXT
 * popup abbreviates with - is a renderer decision, not a shell one.
 *
 * The store notifies on every change in the app, most of which the widget does
 * not care about, so a push only leaves here when the rendered result would
 * actually differ.
 */

let lastPushed = '';
let enabled: boolean | undefined;
let upNext: ObsWidgetUpNext | undefined;

const push = (): void => {
  const { currentSongData, player, userData } = store.state;

  // The preference owns the socket, so it is watched here rather than read
  // once at startup: a user who ticks the box expects OBS to work without
  // restarting the player.
  const wanted = userData?.preferences?.enableObsWidget ?? false;
  if (wanted !== enabled) {
    enabled = wanted;
    // A freshly opened server knows nothing, so the next push must go through
    // even if the song has not changed since the widget was last switched off.
    lastPushed = '';
    window.api.obsWidget
      .setEnabled(wanted)
      .catch((error: unknown) =>
        console.error(`Failed to ${wanted ? 'start' : 'stop'} the OBS widget server.`, error)
      );
  }
  if (!enabled) return;

  const artists = currentSongData.artists
    ?.map((artist) => artist.name)
    .filter((name) => name.length > 0)
    .join(', ');

  const state: ObsWidgetState = {
    title: currentSongData.title || undefined,
    artists: artists || undefined,
    playing: player.isCurrentSongPlaying,
    upNext,
    art: currentSongData.artworkPath || undefined
  };

  const fingerprint = JSON.stringify(state);
  if (fingerprint === lastPushed) return;
  lastPushed = fingerprint;

  window.api.obsWidget.setState(state);
};

/**
 * Mirrors the in-app "UP NEXT" popup into the widget.
 *
 * Called by the popup itself rather than recomputed here on a timer of its
 * own: the popup owns when it appears (five seconds in, then every forty, and
 * on a double Ctrl press), and two independent schedules would drift apart
 * within a single song.
 */
export const reportUpNextToObsWidget = (song?: SongData): void => {
  upNext = song
    ? {
        title: song.title,
        artist: song.artists?.[0]?.name,
        extra: Math.max((song.artists?.length ?? 0) - 1, 0)
      }
    : undefined;
  push();
};

/** Starts the feed. Called once, from the renderer bootstrap. */
export const startObsWidgetFeed = (): void => {
  store.subscribe(push);
  push();
};
