import { describe, expect, test } from '@jest/globals';

import {
  freshMediaUrl,
  MEDIA_ERR_ABORTED,
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  nextRecoveryAction,
  PlaybackRecoveryLedger
} from '../other/playbackRecovery';

/**
 * The behaviour under test is the one the user meets as "the demuxer error came
 * back": a track refuses to play and the app answers with a wall instead of
 * another attempt. Each case below is a cause that used to reach that wall.
 */
describe('the recovery ladder', () => {
  test('the first failure is always answered by a plain retry', () => {
    // Costs nothing, rewrites nothing, and covers the whole family of causes
    // that clear themselves: a file still being copied in, a file held open by
    // an antivirus, a chunk that raced a rewrite.
    expect(
      nextRecoveryAction({ attempt: 1, repairAttempted: false }, MEDIA_ERR_SRC_NOT_SUPPORTED)
    ).toEqual({ step: 'retry', delayMs: 250 });
    expect(nextRecoveryAction({ attempt: 1, repairAttempted: false }, MEDIA_ERR_NETWORK)).toEqual({
      step: 'retry',
      delayMs: 250
    });
  });

  test('the file-rewriting repair is spent only where metadata could be the cause', () => {
    expect(
      nextRecoveryAction({ attempt: 2, repairAttempted: false }, MEDIA_ERR_SRC_NOT_SUPPORTED)
    ).toEqual({ step: 'repair', delayMs: 0 });
    expect(nextRecoveryAction({ attempt: 2, repairAttempted: false }, MEDIA_ERR_DECODE)).toEqual({
      step: 'repair',
      delayMs: 0
    });
    // Nothing about the bytes changed, so rewriting them repairs nothing.
    expect(nextRecoveryAction({ attempt: 2, repairAttempted: false }, MEDIA_ERR_NETWORK)).toEqual({
      step: 'retry',
      delayMs: 1000
    });
  });

  test('a track is never rewritten twice', () => {
    expect(
      nextRecoveryAction({ attempt: 2, repairAttempted: true }, MEDIA_ERR_SRC_NOT_SUPPORTED)
    ).toEqual({ step: 'retry', delayMs: 1000 });
    expect(
      nextRecoveryAction({ attempt: 3, repairAttempted: true }, MEDIA_ERR_SRC_NOT_SUPPORTED)
    ).toEqual({ step: 'retry', delayMs: 2000 });
  });

  test('the waits grow, because a track still being copied in needs seconds', () => {
    // The one cause no repair can touch: the file is not all there yet. This is
    // the rung that makes the difference between a track that plays a moment
    // later and an error the user reads as a corrupt library.
    const delays = [1, 2, 3].map((attempt) => {
      const action = nextRecoveryAction({ attempt, repairAttempted: true }, MEDIA_ERR_NETWORK);
      return action.step === 'report' ? -1 : action.delayMs;
    });
    expect(delays).toEqual([250, 1000, 2000]);
  });

  test('a repair still gets its turn when the first two failures were network-shaped', () => {
    // The shape changing between attempts is exactly what a file finishing its
    // copy looks like, and the metadata defect underneath it deserves its move.
    expect(
      nextRecoveryAction({ attempt: 3, repairAttempted: false }, MEDIA_ERR_SRC_NOT_SUPPORTED)
    ).toEqual({ step: 'repair', delayMs: 0 });
  });

  test('an aborted load is the user changing tracks, not a broken file', () => {
    expect(nextRecoveryAction({ attempt: 1, repairAttempted: false }, MEDIA_ERR_ABORTED)).toEqual({
      step: 'report'
    });
  });

  test('the ladder terminates', () => {
    for (const code of [MEDIA_ERR_SRC_NOT_SUPPORTED, MEDIA_ERR_NETWORK, MEDIA_ERR_DECODE]) {
      expect(nextRecoveryAction({ attempt: 4, repairAttempted: true }, code)).toEqual({
        step: 'report'
      });
      expect(nextRecoveryAction({ attempt: 12, repairAttempted: false }, code)).toEqual({
        step: 'report'
      });
    }
  });
});

describe('the ledger', () => {
  test('counts per track, so one bad file does not spend another one_s attempts', () => {
    const ledger = new PlaybackRecoveryLedger();
    expect(ledger.record('a')).toBe(1);
    expect(ledger.record('a')).toBe(2);
    expect(ledger.record('b')).toBe(1);
    expect(ledger.state('a')).toEqual({ attempt: 2, repairAttempted: false });
  });

  test('remembers that a file was already rewritten', () => {
    const ledger = new PlaybackRecoveryLedger();
    ledger.record('a');
    ledger.markRepairAttempted('a');
    expect(ledger.state('a').repairAttempted).toBe(true);
    expect(ledger.state('b').repairAttempted).toBe(false);
  });

  test('a successful play returns the full set of moves', () => {
    // The old counter never reset, so a long session became permanently less
    // tolerant: the sixth unrelated hiccup of the day was answered with a modal.
    const ledger = new PlaybackRecoveryLedger();
    ledger.record('a');
    ledger.record('a');
    ledger.markRepairAttempted('a');
    ledger.reset();
    expect(ledger.state('a')).toEqual({ attempt: 0, repairAttempted: false });
  });
});

describe('the retry URL', () => {
  test('carries a new stamp so the webview cannot answer from its cache', () => {
    expect(freshMediaUrl('http://nemora.localhost/E%3A%5Ca.flac?ts=1', 2)).toBe(
      'http://nemora.localhost/E%3A%5Ca.flac?ts=2'
    );
  });

  test('adds a stamp to a URL that has none', () => {
    expect(freshMediaUrl('http://nemora.localhost/E%3A%5Ca.flac', 7)).toBe(
      'http://nemora.localhost/E%3A%5Ca.flac?ts=7'
    );
  });
});
