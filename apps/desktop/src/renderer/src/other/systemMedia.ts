import { invoke } from '@tauri-apps/api/core';

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
  const now = song
    ? {
        title: song.title,
        artist: song.artists?.map((artist) => artist.name).join(', ') || fallbacks.artist,
        album: song.album?.name || fallbacks.album,
        artwork: song.artworkPath ?? '',
        duration: Number.isFinite(state.duration) ? state.duration : 0,
        position: Number.isFinite(state.position) ? state.position : 0,
        playing: state.playing
      }
    : null;
  void invoke('smtc_update', { now }).catch((error: unknown) =>
    console.error('Windows media controls were not updated.', error)
  );
};
