/**
 * Pure playlist sorters, byte-for-byte ported from `src/main/utils/sortPlaylists.ts`.
 *
 * Kept inside this subsystem until the shared `sort/**` port lands; the
 * api-bridge may swap this import for the shared implementation later.
 */

const normalizedName = (playlist: Playlist | SavablePlaylist): string =>
  playlist.name.toLowerCase().replace(/\W/gi, '');

const sortAToZ = <T extends (Playlist | SavablePlaylist)[]>(data: T): T => {
  const sorted = [...data] as (Playlist | SavablePlaylist)[];
  sorted.sort((a, b) => {
    const aName = normalizedName(a);
    const bName = normalizedName(b);
    return aName > bName ? 1 : aName < bName ? -1 : 0;
  });
  return sorted as T;
};

const sortZToA = <T extends (Playlist | SavablePlaylist)[]>(data: T): T => {
  const sorted = [...data] as (Playlist | SavablePlaylist)[];
  sorted.sort((a, b) => {
    const aName = normalizedName(a);
    const bName = normalizedName(b);
    return aName < bName ? 1 : aName > bName ? -1 : 0;
  });
  return sorted as T;
};

export default <T extends (Playlist | SavablePlaylist)[]>(data: T, sortType: PlaylistSortTypes) => {
  if (data.length > 0) {
    if (sortType === 'aToZ') return sortAToZ(data);
    if (sortType === 'zToA') return sortZToA(data);
    if (sortType === 'noOfSongsDescending')
      return sortAToZ(data).sort((a, b) =>
        a.songs.length < b.songs.length ? 1 : a.songs.length > b.songs.length ? -1 : 0
      );
    if (sortType === 'noOfSongsAscending')
      return sortAToZ(data).sort((a, b) =>
        a.songs.length > b.songs.length ? 1 : a.songs.length < b.songs.length ? -1 : 0
      );
  }
  return data;
};
