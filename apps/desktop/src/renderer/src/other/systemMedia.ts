import { ipc } from '@platform/ipc';

/**
 * Tells Windows what is playing (media keys, the volume flyout, the lock screen). The webview did
 * this through the Media Session API while it played audio itself; the engine plays now, so the
 * shell drives Windows' media controls natively.
 */
export const updateSystemMedia = (
  song: Pick<AudioPlayerData, 'title' | 'artists' | 'album' | 'artworkPath'> | undefined,
  state: { duration: number; position: number; playing: boolean },
  fallbacks: { artist: string; album: string }
) => {
  // 0 when the length is unknown: the engine says so for a file that does not state it.
  const duration = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 0;
  const position = Number.isFinite(state.position) ? Math.max(state.position, 0) : 0;
  const now = song
    ? {
        title: song.title,
        artist: song.artists?.map((artist) => artist.name).join(', ') || fallbacks.artist,
        album: song.album?.name || fallbacks.album,
        artwork: song.artworkPath ?? '',
        duration,
        position: duration > 0 ? Math.min(position, duration) : 0,
        playing: state.playing
      }
    : null;
  void ipc('smtc_update', { now }).catch((error: unknown) =>
    console.error('Windows media controls were not updated.', error)
  );
};
