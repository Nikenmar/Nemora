/**
 * What the player observed while one song was current, sent to the core when the song stops.
 *
 * 1.x decided here, with timers, what counted as a listen, a full listen or a skip. 2.0 records
 * the facts instead (play, pause, seek and the end, each with the media position and the time),
 * and the core judges them by the listening definitions 2.0: a play is hearing at least
 * min(30 s, half the song), a skip is the user leaving before that, a full listen is 90 % or a
 * natural end.
 */
type Fact =
  | { kind: 'play'; atMs: number; positionMs: number }
  | { kind: 'pause'; atMs: number; positionMs: number }
  | { kind: 'seek'; atMs: number; fromMs: number; toMs: number }
  | { kind: 'end'; atMs: number; positionMs: number; reason: EndReason };

/** Why a session ended; only the user leaving a track (`user_*`) can make it a skip. */
export type EndReason =
  | 'finished'
  | 'user_next'
  | 'user_previous'
  | 'user_selected'
  | 'stopped'
  | 'app_closed';

export type PlaySession = {
  songId: string;
  startedAt: number;
  utcOffsetMin: number;
  durationMs: number;
  sourceKind?: string;
  sourceId?: string;
  facts: Fact[];
};

const ms = (seconds: number) => Math.round(seconds * 1000);

class ListeningDataSession {
  readonly songId: string;
  readonly duration: number;
  readonly isKnownSource: boolean;
  readonly abortController = new AbortController();
  private readonly player: HTMLAudioElement;
  private readonly startedAt = Date.now();
  private readonly facts: Fact[] = [];
  private lastPosition = 0;
  private finished = false;
  private heardSeconds = 0;
  private scrobbled = false;
  private intervalId?: ReturnType<typeof setInterval>;
  private nowPlayingId?: ReturnType<typeof setTimeout>;

  constructor(player: HTMLAudioElement, songId: string, duration: number, isKnownSource = true) {
    this.player = player;
    this.songId = songId;
    this.duration = duration;
    this.isKnownSource = isKnownSource;
  }

  recordListeningData() {
    const { player } = this;
    const { signal } = this.abortController;
    const at = (kind: 'play' | 'pause') => () =>
      this.push({ kind, atMs: Date.now(), positionMs: ms(player.currentTime) });
    if (!player.paused) at('play')();

    player.addEventListener('play', at('play'), { signal });
    player.addEventListener('pause', at('pause'), { signal });
    // `seeking` fires with currentTime already at the target, so the origin is the last position
    // seen while playing.
    player.addEventListener(
      'seeking',
      () => {
        const to = ms(player.currentTime);
        this.push({ kind: 'seek', atMs: Date.now(), fromMs: this.lastPosition, toMs: to });
        this.lastPosition = to;
      },
      { signal }
    );
    player.addEventListener(
      'timeupdate',
      () => {
        if (!player.seeking) this.lastPosition = ms(player.currentTime);
      },
      { signal }
    );
    player.addEventListener('ended', () => this.stopRecording('finished'), { signal });
    window.addEventListener('pagehide', () => this.stopRecording('app_closed'), { signal });

    // Last.fm wants "now playing" early and a scrobble once half the song (or 4 minutes) was heard.
    this.nowPlayingId = setTimeout(
      () => window.api.audioLibraryControls.sendNowPlayingSongDataToLastFM(this.songId),
      2500
    );
    this.intervalId = setInterval(() => {
      if (!player.paused) this.heardSeconds += 1;
      const threshold = Math.min(this.duration / 2, 240);
      if (!this.scrobbled && this.duration > 30 && this.heardSeconds >= threshold) {
        this.scrobbled = true;
        window.api.audioLibraryControls.scrobbleSong(this.songId, this.startedAt / 1000);
      }
    }, 1000);
  }

  /** Ends the session and hands it to the core; later calls do nothing. */
  stopRecording(reason: EndReason = 'user_selected') {
    if (this.finished) return;
    const position =
      reason === 'finished' ? ms(this.duration) : ms(this.player.currentTime) || this.lastPosition;
    this.push({ kind: 'end', atMs: Date.now(), positionMs: position, reason });
    this.finished = true;
    this.abortController.abort();
    clearInterval(this.intervalId);
    clearTimeout(this.nowPlayingId);
    if (!this.isKnownSource) return;
    window.api.audioLibraryControls
      .recordPlaySession({
        songId: this.songId,
        startedAt: this.startedAt,
        utcOffsetMin: -new Date(this.startedAt).getTimezoneOffset(),
        durationMs: ms(this.duration),
        facts: this.facts
      })
      .catch((error: unknown) =>
        console.error(`The session of ${this.songId} was not recorded.`, error)
      );
  }

  private push(fact: Fact) {
    if (!this.finished) this.facts.push(fact);
  }
}

export default ListeningDataSession;
