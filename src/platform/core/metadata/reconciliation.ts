import type {
  CatalogAlbumInput,
  CatalogArtistInput,
  CatalogBatchPlan,
  CatalogGenreInput,
  CatalogPlan,
  CatalogSongPatch,
  MetadataCatalog,
  MetadataTagPatch
} from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cleanName = (value: string): string => value.trim();

const uniqueBy = <T>(values: readonly T[], key: (value: T) => string): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const candidate = key(value);
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
};

const requireName = (value: string, type: string): string => {
  const name = cleanName(value);
  if (!name) throw new Error(`${type} name cannot be empty.`);
  return name;
};

const resolveArtist = (
  artists: SavableArtist[],
  input: CatalogArtistInput,
  createId: () => string,
  artworkName?: string,
  template?: SavableArtist
): SavableArtist => {
  const name = requireName(input.name, 'Artist');
  if (input.artistId) {
    const existing = artists.find((artist) => artist.artistId === input.artistId);
    if (!existing) throw new Error(`Artist does not exist: ${input.artistId}`);
    return existing;
  }

  const byName = artists.find((artist) => artist.name === name);
  if (byName) return byName;

  const artist: SavableArtist = {
    artistId: createId(),
    name,
    songs: [],
    albums: [],
    artworkName: template?.artworkName ?? artworkName,
    isAFavorite: false
  };
  artists.push(artist);
  return artist;
};

const resolveAlbum = (
  albums: SavableAlbum[],
  input: CatalogAlbumInput,
  createId: () => string,
  year?: number,
  artworkName?: string
): SavableAlbum => {
  const title = requireName(input.title, 'Album');
  if (input.albumId) {
    const existing = albums.find((album) => album.albumId === input.albumId);
    if (!existing) throw new Error(`Album does not exist: ${input.albumId}`);
    return existing;
  }

  const byTitle = albums.find((album) => album.title === title);
  if (byTitle) return byTitle;

  const album: SavableAlbum = {
    albumId: createId(),
    title,
    songs: [],
    artists: [],
    year,
    artworkName
  };
  albums.push(album);
  return album;
};

const resolveGenre = (
  genres: SavableGenre[],
  input: CatalogGenreInput,
  createId: () => string,
  artworkName?: string
): SavableGenre => {
  const name = requireName(input.name, 'Genre');
  if (input.genreId) {
    const existing = genres.find((genre) => genre.genreId === input.genreId);
    if (!existing) throw new Error(`Genre does not exist: ${input.genreId}`);
    return existing;
  }

  const byName = genres.find((genre) => genre.name === name);
  if (byName) return byName;

  const genre: SavableGenre = {
    genreId: createId(),
    name,
    songs: [],
    artworkName
  };
  genres.push(genre);
  return genre;
};

const pushSong = (target: { songId: string; title: string }[], song: SavableSongData): void => {
  if (!target.some((entry) => entry.songId === song.songId)) {
    target.push({ songId: song.songId, title: song.title });
  }
};

const pushAlbum = (target: { albumId: string; title: string }[], album: SavableAlbum): void => {
  if (!target.some((entry) => entry.albumId === album.albumId)) {
    target.push({ albumId: album.albumId, title: album.title });
  }
};

export const validateCatalog = (catalog: MetadataCatalog): void => {
  const songIds = new Set(catalog.songs.map((song) => song.songId));
  const artistIds = new Set(catalog.artists.map((artist) => artist.artistId));
  const albumIds = new Set(catalog.albums.map((album) => album.albumId));
  const genreIds = new Set(catalog.genres.map((genre) => genre.genreId));

  if (songIds.size !== catalog.songs.length)
    throw new Error('Catalog contains duplicate song IDs.');
  if (artistIds.size !== catalog.artists.length)
    throw new Error('Catalog contains duplicate artist IDs.');
  if (albumIds.size !== catalog.albums.length)
    throw new Error('Catalog contains duplicate album IDs.');
  if (genreIds.size !== catalog.genres.length)
    throw new Error('Catalog contains duplicate genre IDs.');

  for (const song of catalog.songs) {
    for (const artist of [...(song.artists ?? []), ...(song.albumArtists ?? [])]) {
      if (!artistIds.has(artist.artistId)) {
        throw new Error(`Song ${song.songId} references missing artist ${artist.artistId}.`);
      }
    }
    if (song.album && !albumIds.has(song.album.albumId)) {
      throw new Error(`Song ${song.songId} references missing album ${song.album.albumId}.`);
    }
    for (const genre of song.genres ?? []) {
      if (!genreIds.has(genre.genreId)) {
        throw new Error(`Song ${song.songId} references missing genre ${genre.genreId}.`);
      }
    }
  }

  for (const artist of catalog.artists) {
    if (artist.songs.some((song) => !songIds.has(song.songId))) {
      throw new Error(`Artist ${artist.artistId} references a missing song.`);
    }
    if (artist.albums?.some((album) => !albumIds.has(album.albumId))) {
      throw new Error(`Artist ${artist.artistId} references a missing album.`);
    }
  }
  for (const album of catalog.albums) {
    if (album.songs.some((song) => !songIds.has(song.songId))) {
      throw new Error(`Album ${album.albumId} references a missing song.`);
    }
    if (album.artists?.some((artist) => !artistIds.has(artist.artistId))) {
      throw new Error(`Album ${album.albumId} references a missing artist.`);
    }
  }
  for (const genre of catalog.genres) {
    if (genre.songs.some((song) => !songIds.has(song.songId))) {
      throw new Error(`Genre ${genre.genreId} references a missing song.`);
    }
  }
};

const rebuildRelationships = (catalog: MetadataCatalog): MetadataCatalog => {
  const artists: SavableArtist[] = catalog.artists.map((artist) => ({
    ...artist,
    songs: [],
    albums: []
  }));
  const albums: SavableAlbum[] = catalog.albums.map((album) => ({
    ...album,
    songs: [],
    artists: []
  }));
  const genres: SavableGenre[] = catalog.genres.map((genre) => ({ ...genre, songs: [] }));
  const artistById = new Map(artists.map((artist) => [artist.artistId, artist]));
  const albumById = new Map(albums.map((album) => [album.albumId, album]));
  const genreById = new Map(genres.map((genre) => [genre.genreId, genre]));

  for (const song of catalog.songs) {
    const directArtists = uniqueBy(song.artists ?? [], (artist) => artist.artistId);
    const albumArtists = uniqueBy(song.albumArtists ?? [], (artist) => artist.artistId);
    song.artists = directArtists;
    song.albumArtists = albumArtists;

    for (const reference of uniqueBy(
      [...directArtists, ...albumArtists],
      (artist) => artist.artistId
    )) {
      const artist = artistById.get(reference.artistId);
      if (!artist)
        throw new Error(`Song ${song.songId} references missing artist ${reference.artistId}.`);
      reference.name = artist.name;
      pushSong(artist.songs, song);
    }

    if (song.album) {
      const album = albumById.get(song.album.albumId);
      if (!album)
        throw new Error(`Song ${song.songId} references missing album ${song.album.albumId}.`);
      song.album.name = album.title;
      pushSong(album.songs, song);
      const credited = albumArtists.length > 0 ? albumArtists : directArtists;
      for (const reference of credited) {
        const artist = artistById.get(reference.artistId);
        if (!artist)
          throw new Error(
            `Album ${album.albumId} references missing artist ${reference.artistId}.`
          );
        if (!album.artists?.some((entry) => entry.artistId === artist.artistId)) {
          album.artists?.push({ artistId: artist.artistId, name: artist.name });
        }
        pushAlbum(artist.albums ?? (artist.albums = []), album);
      }
    }

    song.genres = uniqueBy(song.genres ?? [], (genre) => genre.genreId);
    for (const reference of song.genres) {
      const genre = genreById.get(reference.genreId);
      if (!genre)
        throw new Error(`Song ${song.songId} references missing genre ${reference.genreId}.`);
      reference.name = genre.name;
      pushSong(genre.songs, song);
    }
  }

  const rebuilt: MetadataCatalog = {
    songs: catalog.songs,
    artists: artists.filter((artist) => artist.songs.length > 0),
    albums: albums.filter((album) => album.songs.length > 0),
    genres: genres.filter((genre) => genre.songs.length > 0)
  };
  validateCatalog(rebuilt);
  return rebuilt;
};

export const planSongRelink = (
  source: MetadataCatalog,
  songId: string,
  patch: CatalogSongPatch,
  createId: () => string
): CatalogPlan => {
  const catalog = clone(source);
  const song = catalog.songs.find((entry) => entry.songId === songId);
  if (!song) throw new Error(`Song does not exist: ${songId}`);

  const artworkName = patch.artworkName;
  if (patch.title !== undefined) song.title = requireName(patch.title, 'Song title');
  if (Object.hasOwn(patch, 'year')) song.year = patch.year || undefined;
  if (Object.hasOwn(patch, 'trackNumber')) song.trackNo = patch.trackNumber || undefined;
  if (Object.hasOwn(patch, 'discNumber')) song.discNo = patch.discNumber || undefined;
  if (patch.duration !== undefined) song.duration = Math.round(patch.duration * 100) / 100;
  if (Object.hasOwn(patch, 'bitrate')) song.bitrate = patch.bitrate || undefined;
  if (Object.hasOwn(patch, 'sampleRate')) song.sampleRate = patch.sampleRate || undefined;
  if (Object.hasOwn(patch, 'numberOfChannels')) {
    song.noOfChannels = patch.numberOfChannels || undefined;
  }
  if (Object.hasOwn(patch, 'createdDate')) song.createdDate = patch.createdDate ?? undefined;
  if (Object.hasOwn(patch, 'modifiedDate')) song.modifiedDate = patch.modifiedDate ?? undefined;
  if (patch.artworkAvailable !== undefined) song.isArtworkAvailable = patch.artworkAvailable;
  if (patch.artworkName) {
    for (const reference of [...(song.artists ?? []), ...(song.albumArtists ?? [])]) {
      const artist = catalog.artists.find((entry) => entry.artistId === reference.artistId);
      if (artist && !artist.artworkName) artist.artworkName = patch.artworkName;
    }
    if (song.album) {
      const album = catalog.albums.find((entry) => entry.albumId === song.album?.albumId);
      if (album && !album.artworkName) album.artworkName = patch.artworkName;
    }
    for (const reference of song.genres ?? []) {
      const genre = catalog.genres.find((entry) => entry.genreId === reference.genreId);
      if (genre && !genre.artworkName) genre.artworkName = patch.artworkName;
    }
  }

  if (patch.artists !== undefined) {
    const resolved = patch.artists.map((artist) =>
      resolveArtist(catalog.artists, artist, createId, artworkName)
    );
    song.artists = uniqueBy(resolved, (artist) => artist.artistId).map(({ artistId, name }) => ({
      artistId,
      name
    }));
  }

  if (patch.albumArtists !== undefined) {
    const resolved = patch.albumArtists.map((artist) =>
      resolveArtist(catalog.artists, artist, createId, artworkName)
    );
    song.albumArtists = uniqueBy(resolved, (artist) => artist.artistId).map(
      ({ artistId, name }) => ({ artistId, name })
    );
  }

  if ('album' in patch) {
    if (patch.album) {
      const album = resolveAlbum(catalog.albums, patch.album, createId, song.year, artworkName);
      song.album = { albumId: album.albumId, name: album.title };
    } else song.album = undefined;
  }

  if (patch.genres !== undefined) {
    const resolved = patch.genres.map((genre) =>
      resolveGenre(catalog.genres, genre, createId, artworkName)
    );
    song.genres = uniqueBy(resolved, (genre) => genre.genreId).map(({ genreId, name }) => ({
      genreId,
      name
    }));
  }

  const rebuilt = rebuildRelationships(catalog);
  const updatedSong = rebuilt.songs.find((entry) => entry.songId === songId);
  if (!updatedSong) throw new Error(`Reconciled song disappeared: ${songId}`);
  return { catalog: rebuilt, song: updatedSong };
};

const replaceArtist = (
  values: readonly { artistId: string; name: string }[],
  removedIds: ReadonlySet<string>,
  replacements: readonly SavableArtist[]
): { artistId: string; name: string }[] => {
  if (!values.some((value) => removedIds.has(value.artistId))) return [...values];
  const retained = values.filter((value) => !removedIds.has(value.artistId));
  return uniqueBy(
    [...retained, ...replacements.map(({ artistId, name }) => ({ artistId, name }))],
    (artist) => artist.artistId
  );
};

const buildArtistBatchPlan = (
  catalog: MetadataCatalog,
  affectedSongIds: ReadonlySet<string>
): CatalogBatchPlan => {
  const rebuilt = rebuildRelationships(catalog);
  const tagPatches = new Map<string, MetadataTagPatch>();
  for (const song of rebuilt.songs) {
    if (!affectedSongIds.has(song.songId)) continue;
    tagPatches.set(song.songId, {
      artists: (song.artists ?? []).map((artist) => artist.name),
      albumArtists: (song.albumArtists ?? []).map((artist) => artist.name)
    });
  }
  return { catalog: rebuilt, songIds: [...affectedSongIds], tagPatches };
};

export const planArtistDuplicateMerge = (
  source: MetadataCatalog,
  selectedArtistId: string,
  duplicateIds: readonly string[]
): CatalogBatchPlan => {
  const catalog = clone(source);
  const selected = catalog.artists.find((artist) => artist.artistId === selectedArtistId);
  if (!selected) throw new Error(`Selected artist does not exist: ${selectedArtistId}`);
  const removedIds = new Set(duplicateIds);
  if (removedIds.size === 0) throw new Error('At least one duplicate artist is required.');
  if (removedIds.size !== duplicateIds.length)
    throw new Error('Duplicate artist IDs must be unique.');
  if (removedIds.has(selectedArtistId))
    throw new Error('Selected artist cannot be merged into itself.');
  for (const duplicateId of removedIds) {
    if (!catalog.artists.some((artist) => artist.artistId === duplicateId)) {
      throw new Error(`Duplicate artist does not exist: ${duplicateId}`);
    }
  }

  const affected = new Set<string>();
  for (const song of catalog.songs) {
    const references = [...(song.artists ?? []), ...(song.albumArtists ?? [])];
    if (!references.some((artist) => removedIds.has(artist.artistId))) continue;
    song.artists = replaceArtist(song.artists ?? [], removedIds, [selected]);
    song.albumArtists = replaceArtist(song.albumArtists ?? [], removedIds, [selected]);
    affected.add(song.songId);
  }
  catalog.artists = catalog.artists.filter((artist) => !removedIds.has(artist.artistId));
  return buildArtistBatchPlan(catalog, affected);
};

export const planSeparateArtist = (
  source: MetadataCatalog,
  selectedArtistId: string,
  separateArtistNames: readonly string[],
  createId: () => string
): CatalogBatchPlan => {
  const catalog = clone(source);
  const selected = catalog.artists.find((artist) => artist.artistId === selectedArtistId);
  if (!selected) throw new Error(`Artist does not exist: ${selectedArtistId}`);
  const names = uniqueBy(
    separateArtistNames.map((name) => requireName(name, 'Artist')),
    (name) => name.toLocaleLowerCase('en-US')
  );
  if (names.length === 0) throw new Error('At least one separated artist name is required.');
  if (names.some((name) => name === selected.name)) {
    throw new Error('Separated artist names cannot include the artist being replaced.');
  }
  const replacements = names.map((name) =>
    resolveArtist(catalog.artists, { name }, createId, selected.artworkName, selected)
  );
  const removed = new Set([selectedArtistId]);
  const affected = new Set<string>();
  for (const song of catalog.songs) {
    const references = [...(song.artists ?? []), ...(song.albumArtists ?? [])];
    if (!references.some((artist) => artist.artistId === selectedArtistId)) continue;
    song.artists = replaceArtist(song.artists ?? [], removed, replacements);
    song.albumArtists = replaceArtist(song.albumArtists ?? [], removed, replacements);
    affected.add(song.songId);
  }
  catalog.artists = catalog.artists.filter((artist) => artist.artistId !== selectedArtistId);
  return buildArtistBatchPlan(catalog, affected);
};

const FEATURING_ARTIST = /\s*\(?\s*feat\.?\s+[^)]+\)?/giu;

export const planFeaturingArtists = (
  source: MetadataCatalog,
  songId: string,
  names: readonly string[],
  removeFeaturingFromTitle: boolean,
  createId: () => string
): CatalogBatchPlan => {
  const catalog = clone(source);
  const current = catalog.songs.find((song) => song.songId === songId);
  if (!current) throw new Error(`Song does not exist: ${songId}`);
  const additions = uniqueBy(
    names.map((name) => ({ name: requireName(name, 'Artist') })),
    (artist) => artist.name.toLocaleLowerCase('en-US')
  );
  if (additions.length === 0) throw new Error('At least one featuring artist is required.');
  const nextTitle = removeFeaturingFromTitle
    ? current.title.replace(FEATURING_ARTIST, '').trim()
    : current.title;
  const plan = planSongRelink(
    catalog,
    songId,
    {
      title: nextTitle,
      artists: [...(current.artists ?? []), ...additions]
    },
    createId
  );
  return {
    catalog: plan.catalog,
    songIds: [songId],
    tagPatches: new Map([
      [
        songId,
        {
          title: plan.song.title,
          artists: (plan.song.artists ?? []).map((artist) => artist.name)
        }
      ]
    ])
  };
};
