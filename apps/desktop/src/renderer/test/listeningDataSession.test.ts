import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListeningDataSession from '@renderer/other/listeningDataSession';
import { apiCalls } from './setup';

/**
 * PLAN/21 P21.0: the listening session's facts, frozen. A fake player is driven through play,
 * pause, seeks and an end under fake timers; what reaches the core (`recordPlaySession`) and
 * Last.fm is the snapshot of today's behaviour.
 */
class FakePlayer extends EventTarget {
  paused = true;
  seeking = false;
  currentTime = 0;
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  seek(to: number) {
    this.seeking = true;
    this.currentTime = to;
    this.dispatchEvent(new Event('seeking'));
    this.seeking = false;
  }
  tick(seconds: number) {
    for (let i = 0; i < seconds; i++) {
      this.currentTime += 1;
      this.dispatchEvent(new Event('timeupdate'));
      vi.advanceTimersByTime(1000);
    }
  }
}

const recorded = () => apiCalls.filter((c) => c.path.endsWith('recordPlaySession')).map((c) => c.args[0]);

describe('ListeningDataSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    apiCalls.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('records play, pause, a seek and the finish, then hands the session over once', () => {
    const player = new FakePlayer();
    // A seek before the first play only sets where the song starts.
    const session = new ListeningDataSession(player, 'song-a', 300, true, 'user_selected');
    session.recordListeningData();
    player.seek(12);
    player.play();
    player.tick(30);
    player.pause();
    vi.advanceTimersByTime(5000);
    player.play();
    player.tick(10);
    player.seek(200);
    // The player reports a little short of the end when it ends: the session ends at the duration.
    player.tick(99);
    player.dispatchEvent(new Event('ended'));
    session.stopRecording('user_next');
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchSnapshot();
    const lastFm = apiCalls.filter((c) => /LastFM|scrobble/.test(c.path)).map((c) => c.path);
    expect(lastFm).toMatchSnapshot();
  });

  it('ends where the player is when the user moves on', () => {
    const player = new FakePlayer();
    const session = new ListeningDataSession(player, 'song-b', 180);
    player.paused = false;
    session.recordListeningData();
    player.tick(20);
    session.stopRecording('user_next');
    expect(recorded()[0]).toMatchSnapshot();
  });

  it('records nothing for a song from an unknown source', () => {
    const player = new FakePlayer();
    const session = new ListeningDataSession(player, 'file', 100, false);
    session.recordListeningData();
    player.play();
    player.tick(5);
    session.stopRecording('finished');
    expect(recorded()).toHaveLength(0);
  });
});
