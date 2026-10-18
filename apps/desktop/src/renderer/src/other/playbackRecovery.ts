/**
 * What to do when the player refuses a track.
 *
 * The failure this exists for is `DEMUXER_ERROR_COULD_NOT_OPEN`, the error this
 * whole fork started from. It reaches the renderer as a bare
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` with no cause attached, and the causes it can
 * stand for are not one thing:
 *
 *   * an embedded picture the demuxer will not accept - the original defect,
 *     repairable, see `pictureFormat.ts`;
 *   * a file that is not finished arriving - still being copied into the
 *     library, held by an antivirus, half-written by another tagger. The
 *     protocol answers `503` for exactly this, and a moment later the same
 *     request succeeds;
 *   * a file genuinely beyond help.
 *
 * The old handler knew only the first, tried it once, and on anything else put
 * a modal error dialog on screen. Two of the three causes above therefore
 * looked, to the user, like the founding bug had come back. So the policy here
 * does not diagnose: it tries the cheap and non-destructive move first, spends
 * the one destructive move (rewriting the file) only on the failure shape that
 * can be caused by metadata, and when it runs out of moves it says so quietly
 * instead of blocking the app.
 *
 * Pure on purpose - no player, no DOM, no timers - so the ladder can be tested
 * without a real audio element.
 */

/** `MediaError` codes, spelled out because the DOM constants need an instance. */
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export type PlaybackRecoveryAction =
  /** Load the same track again from a fresh URL, after waiting. */
  | { step: 'retry'; delayMs: number }
  /**
   * Repair the file's embedded pictures, then load again. Costs a rewrite of
   * the user's file, so it is spent once per track and only where metadata
   * could plausibly be the cause.
   */
  | { step: 'repair'; delayMs: number }
  /** Out of moves: log it, tell the user in passing, do not block the app. */
  | { step: 'report' };

export interface PlaybackRecoveryState {
  /** How many failures this track has produced, including the current one. */
  attempt: number;
  /** Whether the file-rewriting repair has already been spent on this track. */
  repairAttempted: boolean;
}

/**
 * A failure whose cause could be inside the file's metadata.
 *
 * `SRC_NOT_SUPPORTED` is the demuxer refusing to open the container at all, and
 * `DECODE` is it failing part way through; both are shapes a malformed picture
 * frame produces. A network-class failure is not - nothing about the bytes
 * changed - so the repair is not spent on it.
 */
const isRepairable = (code: number | undefined): boolean =>
  code === MEDIA_ERR_SRC_NOT_SUPPORTED || code === MEDIA_ERR_DECODE;

/**
 * The ladder, in order. Each rung is cheaper to be wrong about than the next.
 *
 * The delays grow because the causes they wait out do. 250 ms covers a lock
 * someone else is holding; the seconds after it cover a track still being
 * copied into the library, which is a real way to meet this failure and one no
 * amount of repairing the file can help with - it simply is not all there yet.
 * Four rungs is a little over three seconds of patience before the app says
 * anything, which is long enough for the causes that pass and short enough that
 * a user who pressed play is not left wondering.
 */
export const nextRecoveryAction = (
  state: PlaybackRecoveryState,
  code: number | undefined
): PlaybackRecoveryAction => {
  // An aborted load is not a failure of the file; it is what a user switching
  // tracks quickly produces. Retrying it would fight the user.
  if (code === MEDIA_ERR_ABORTED) return { step: 'report' };

  if (state.attempt <= 1) return { step: 'retry', delayMs: 250 };

  if (state.attempt === 2) {
    if (isRepairable(code) && !state.repairAttempted) return { step: 'repair', delayMs: 0 };
    return { step: 'retry', delayMs: 1000 };
  }

  if (state.attempt === 3) {
    // The repair still gets its turn here: the first two failures can be
    // network-shaped while the defect underneath is in the metadata.
    if (isRepairable(code) && !state.repairAttempted) return { step: 'repair', delayMs: 0 };
    return { step: 'retry', delayMs: 2000 };
  }

  return { step: 'report' };
};

/**
 * Per-track memory of what has already been tried.
 *
 * Keyed by song id where there is one and by path otherwise, because a track
 * played from outside the library has no id - and the id is not stable across a
 * library rebuild anyway.
 */
export class PlaybackRecoveryLedger {
  private readonly attempts = new Map<string, number>();
  private readonly repairs = new Set<string>();

  /** Records one failure and returns which attempt it is. */
  record(key: string): number {
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    return attempt;
  }

  state(key: string): PlaybackRecoveryState {
    return {
      attempt: this.attempts.get(key) ?? 0,
      repairAttempted: this.repairs.has(key)
    };
  }

  markRepairAttempted(key: string): void {
    this.repairs.add(key);
  }

  /**
   * Forgets everything.
   *
   * Called when a track actually plays: the counters exist to bound a run of
   * consecutive failures, and a successful play proves the run is over. Without
   * this the app used to grow permanently less tolerant as a session went on -
   * the old error counter only ever incremented, so the sixth hiccup of the day
   * became a modal no matter how long ago the fifth was.
   */
  reset(): void {
    this.attempts.clear();
    this.repairs.clear();
  }
}

/**
 * Replaces the cache-busting stamp on a media URL.
 *
 * A plain `load()` can be answered from the webview's cache with the same
 * failed response, which makes every retry look like proof that the file is
 * broken. The query string is ignored by the protocol handler; the path is
 * percent-encoded, so it never contains a literal `?`.
 */
export const freshMediaUrl = (currentSrc: string, now: number = Date.now()): string =>
  `${currentSrc.split('?')[0]}?ts=${now}`;
