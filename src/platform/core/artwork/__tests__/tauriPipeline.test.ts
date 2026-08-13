/**
 * What the REAL pipeline does with each kind of source.
 *
 * `pipelineSelection.test.ts` proves the service picks the native route when
 * one is offered; it uses a stub pipeline, so it cannot see the pipeline itself
 * declining. That gap shipped: the `audio` source added with the native library
 * scan was never taught to `nativePath`, so every cover in a scanned library
 * quietly fell back to the canvas - on the UI thread, one at a time, after an
 * extra round trip that pulled the picture into the renderer. Covers took
 * twelve seconds where the encoder needed two, and nothing failed.
 *
 * These tests assert the two decisions the pipeline actually makes: whether it
 * takes a source at all, and which command it sends it to.
 */
import { describe, expect, jest, test } from '@jest/globals';

const invoke = jest.fn<(command: string, args?: unknown) => Promise<unknown>>();
jest.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string, unknown])) }));

import { audioArtwork, embeddedArtwork, pathArtwork, urlArtwork } from '../artworkSource';
import { IMAGE_PROFILES } from '../imageTransform';
import { TauriArtworkPipeline } from '../tauriPipeline';

const jobs = [{ destination: 'E:\\covers\\song.webp', profile: IMAGE_PROFILES.fullWebp }];

describe('which sources the native pipeline takes', () => {
  test('an audio source is native: it names a file Rust can open', () => {
    const pipeline = new TauriArtworkPipeline();
    expect(pipeline.nativePath(audioArtwork('E:\\Music\\track.flac', 'image/jpeg'))).toBe(
      'E:\\Music\\track.flac'
    );
  });

  test('an embedded source is native when it remembers where it came from', () => {
    const pipeline = new TauriArtworkPipeline();
    expect(
      pipeline.nativePath(embeddedArtwork(new Uint8Array([1]), 'image/png', 'E:\\Music\\a.mp3'))
    ).toBe('E:\\Music\\a.mp3');
    // Without a path there is nothing for Rust to open, and the browser route
    // still has the bytes.
    expect(pipeline.nativePath(embeddedArtwork(new Uint8Array([1]), 'image/png'))).toBeUndefined();
  });

  test('a URL is not native', () => {
    const pipeline = new TauriArtworkPipeline();
    expect(pipeline.nativePath(urlArtwork('https://example.invalid/cover.jpg'))).toBeUndefined();
  });
});

describe('which command each source is sent to', () => {
  test('an audio source goes to the audio command, not the image one', async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(true);
    const pipeline = new TauriArtworkPipeline();

    await expect(pipeline.write(audioArtwork('E:\\Music\\track.flac'), jobs)).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = invoke.mock.calls[0] as [string, { source: string }];
    expect(command).toBe('artwork_transform_audio');
    expect(args.source).toBe('E:\\Music\\track.flac');
  });

  test('an image already on disk goes to the file command', async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    const pipeline = new TauriArtworkPipeline();

    await pipeline.write(pathArtwork('E:\\covers\\existing.webp'), jobs);

    expect((invoke.mock.calls[0] as [string, unknown])[0]).toBe('artwork_transform_file');
  });

  test('a file with no embedded picture is answered honestly, not as a failure', async () => {
    invoke.mockReset();
    // The audio command answers false for "this file simply has no picture".
    invoke.mockResolvedValue(false);
    const pipeline = new TauriArtworkPipeline();

    await expect(pipeline.write(audioArtwork('E:\\Music\\bare.mp3'), jobs)).resolves.toBe(false);
  });

  test('a missing command closes the route for the session, one bad file does not', async () => {
    invoke.mockReset();
    const pipeline = new TauriArtworkPipeline();

    invoke.mockRejectedValueOnce(new Error('this file is locked'));
    await expect(pipeline.write(audioArtwork('E:\\Music\\a.flac'), jobs)).resolves.toBe(false);
    invoke.mockResolvedValueOnce(true);
    await expect(pipeline.write(audioArtwork('E:\\Music\\b.flac'), jobs)).resolves.toBe(true);

    invoke.mockRejectedValueOnce(new Error('Command artwork_transform_audio not found'));
    await expect(pipeline.write(audioArtwork('E:\\Music\\c.flac'), jobs)).resolves.toBe(false);
    // Closed: no further call is even attempted.
    const before = invoke.mock.calls.length;
    await expect(pipeline.write(audioArtwork('E:\\Music\\d.flac'), jobs)).resolves.toBe(false);
    expect(invoke.mock.calls.length).toBe(before);
  });
});
