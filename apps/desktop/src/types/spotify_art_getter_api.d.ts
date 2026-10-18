/**
 * The slice of Spotify's track object that CMR's art-getter service returns
 * unchanged (`/api/apee?inputType=tracks&id=...`).
 *
 * Deliberately narrow: the response carries the whole track object, and typing
 * the parts nothing reads would be a promise about a shape this app never
 * checks. Everything here is optional because the proxy hands the payload
 * through untouched, so a Spotify change reaches the app before we do.
 */
export interface SpotifyImage {
  url: string;
  width?: number;
  height?: number;
}

export interface SpotifyTrackResponse {
  album?: {
    images?: SpotifyImage[];
  };
}
