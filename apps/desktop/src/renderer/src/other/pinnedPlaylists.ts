/**
 * Playlists pinned to the sidebar: a list of ids in the shared `preferences` (so it follows the
 * profile), with an in-page event so the sidebar redraws when a pin changes anywhere.
 */
const CHANGED = 'nemora:pinned-playlists';

export async function pinnedPlaylists(): Promise<string[]> {
  try {
    return (await window.api.userData.getUserData())?.preferences?.pinnedPlaylists ?? [];
  } catch {
    return [];
  }
}

export async function setPinnedPlaylists(ids: string[]) {
  await window.api.userData.saveUserData('preferences.pinnedPlaylists', ids);
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: ids }));
}

export async function togglePinnedPlaylist(playlistId: string) {
  const ids = await pinnedPlaylists();
  await setPinnedPlaylists(
    ids.includes(playlistId) ? ids.filter((id) => id !== playlistId) : [...ids, playlistId]
  );
}

export function onPinnedPlaylistsChange(listener: (ids: string[]) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<string[]>).detail);
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}
