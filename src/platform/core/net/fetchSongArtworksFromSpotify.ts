import type { SpotifyTrackResponse } from '../../../types/spotify_art_getter_api';
import { logger } from './logger';

/**
 * Cover art for a Spotify track id, through CMR's own art-getter service.
 *
 * The service is a thin proxy in front of the Spotify Web API: it holds the
 * client credentials, exchanges them for a token per request and returns the
 * track object unchanged (K:\art-getter-spotify\api\apee.js).
 *
 * What it replaces is worth recording, because the old route looked like it
 * worked and did not. It asked `open.spotify.com/oembed` - a public embed
 * endpoint, no key needed - for a thumbnail, then rebuilt a bigger URL by
 * swapping the size marker `1e02` for `b273` inside the returned image address.
 * Two things were wrong with that. The URL format it depended on is nobody's
 * contract, so a change in how Spotify names images would have silently
 * produced dead links; and the request never left the app anyway, because
 * `open.spotify.com` was missing from the HTTP allowlist while `i.scdn.co` was
 * there - so the app was allowed to download a cover but not to ask which one.
 *
 * The proxy answers with the real `album.images` array instead: actual URLs at
 * actual sizes, sorted largest first by Spotify.
 */
const ART_GETTER_TRACK_URL =
  'https://art-getter-reborncmr.vercel.app/api/apee?inputType=tracks&id=';

const fetchSongArtworksFromSpotify = async (spotifySongId: string) => {
  try {
    const res = await fetch(ART_GETTER_TRACK_URL + encodeURIComponent(spotifySongId));
    if (!res.ok) throw new Error(`Art-getter responded with ${res.status}.`);

    const track = (await res.json()) as SpotifyTrackResponse;
    const images = (track.album?.images ?? []).filter(
      (image): image is { url: string; width?: number; height?: number } =>
        typeof image?.url === 'string' && image.url.length > 0
    );
    if (images.length === 0) throw new Error('No cover art in the track response.');

    // Spotify orders these largest first, but ordering is not something to lean
    // on when one bad guess puts a 64px thumbnail into someone's tags.
    const bySize = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const highResArtworkUrl = bySize[0].url;

    // The second choice is the smallest cover still worth embedding, not the
    // smallest one on offer: Spotify's third image is a 64px list thumbnail, and
    // both of these end up in the tag editor as pickable album art. An option
    // nobody should choose does not belong in a picker.
    const MIN_USEFUL_WIDTH = 200;
    const usable = bySize.filter((image) => (image.width ?? 0) >= MIN_USEFUL_WIDTH);
    const lowResArtworkUrl = (usable.at(-1) ?? bySize[0]).url;

    return { highResArtworkUrl, lowResArtworkUrl };
  } catch (error) {
    logger.debug(`Failed to fetch artwork from url.`, { error, spotifySongId });
    return undefined;
  }
};

export default fetchSongArtworksFromSpotify;
