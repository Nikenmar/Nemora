import { subscribeNoPayload, unsubscribe } from './events';
import { setTaskbarPlaybackState } from './taskbar-buttons';
import { getRuntime } from '../runtime';

type EmptyCallback = (event: unknown) => void;

const PLAY_PAUSE_EVENT = 'nemora://taskbar/play-pause';
const PREVIOUS_EVENT = 'nemora://taskbar/previous';
const NEXT_EVENT = 'nemora://taskbar/next';
const DISCORD_ACTIVITY_WINDOW_MS = 3_000;

interface RendererDiscordActivity {
  details?: string;
  state?: string;
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  timestamps?: { start?: number; end?: number };
  buttons?: { label: string; url: string }[];
}

/**
 * Discord timestamps are integer milliseconds.
 *
 * The renderer derives them from `player.currentTime`, a float number of
 * seconds, so the result is virtually never integral. That single non-integer
 * made the Rust command reject the ENTIRE activity, taking the title, the
 * artist and the artwork with it — the presence sat on its connect-time
 * placeholder and the only trace was one caught console error.
 */
const toMillis = (value?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;

let discordActivityQueue: RendererDiscordActivity[] = [];

const sendDiscordActivity = (input: RendererDiscordActivity): void => {
  const activity = {
    details: input.details,
    state: input.state,
    largeImage: input.assets?.large_image,
    largeText: input.assets?.large_text,
    smallImage: input.assets?.small_image,
    smallText: input.assets?.small_text,
    startTimestamp: toMillis(input.timestamps?.start),
    endTimestamp: toMillis(input.timestamps?.end),
    buttons: input.buttons
  };
  void getRuntime()
    .setDiscordActivity(activity)
    .catch((error: unknown) => console.error('Failed to update Discord Rich Presence.', error));
};

const setDiscordRpcActivity = (options: unknown): void => {
  const enabled = getRuntime().getUserData().preferences.enableDiscordRPC;
  if (!enabled) return;
  const input = (options ?? {}) as RendererDiscordActivity;
  if (discordActivityQueue.length === 0) {
    sendDiscordActivity(input);
    setTimeout(() => {
      if (discordActivityQueue.length > 1) {
        const latest = discordActivityQueue.at(-1);
        if (latest) sendDiscordActivity(latest);
      }
      discordActivityQueue = [];
    }, DISCORD_ACTIVITY_WINDOW_MS);
  }
  discordActivityQueue.push(input);
};

export const playerControls = {
  songPlaybackStateChange: setTaskbarPlaybackState,
  toggleSongPlayback: (callback: EmptyCallback): void =>
    subscribeNoPayload(PLAY_PAUSE_EVENT, callback),
  skipForwardToNextSong: (callback: EmptyCallback): void =>
    subscribeNoPayload(NEXT_EVENT, callback),
  skipBackwardToPreviousSong: (callback: EmptyCallback): void =>
    subscribeNoPayload(PREVIOUS_EVENT, callback),
  sendSongPosition: (position: number): void =>
    getRuntime().saveUserData('currentSong.stoppedPosition', position),
  setDiscordRpcActivity,
  toggleLikeSongs: (
    songIds: string[],
    isLikeSong?: boolean
  ): Promise<ToggleLikeSongReturnValue | undefined> =>
    getRuntime().toggleLikeSongs(songIds, isLikeSong),
  removeTogglePlaybackStateEvent: (callback: EmptyCallback): void =>
    unsubscribe(PLAY_PAUSE_EVENT, callback),
  removeSkipBackwardToPreviousSongEvent: (callback: EmptyCallback): void =>
    unsubscribe(PREVIOUS_EVENT, callback),
  removeSkipForwardToNextSongEvent: (callback: EmptyCallback): void =>
    unsubscribe(NEXT_EVENT, callback)
};
