export type LastFMTrackInfoApi =
  | {
      track: LastFMTrackData;
    }
  | LastFMError;

interface LastFMTrackData {
  name: string;
  url: string;
  duration: string;
  streamable: LastFMTrackStreamable;
  listeners: string;
  playcount: string;
  artist: LastFMTrackArtist;
  album: LastFMTrackAlbum;
  toptags: {
    tag: LastFMTrackTag[];
  };
  wiki?: LastFMTrackWiki;
}

interface LastFMTrackAlbum {
  artist: string;
  title: string;
  url: string;
  image: LastFMTrackAlbumImage[];
}

interface LastFMTrackAlbumImage {
  '#text': string;
  size: string;
}

interface LastFMTrackArtist {
  name: string;
  mbid?: string;
  url: string;
}

interface LastFMTrackStreamable {
  '#text': string;
  fulltrack: string;
}

interface LastFMTrackTag {
  name: string;
  url: string;
}

interface LastFMTrackWiki {
  published: string;
  summary: string;
  content: string;
}

export interface LastFMHitCache {
  id: string;
  data: SongMetadataResultFromInternet;
}

type LastFMError = { message: string; error: number };
