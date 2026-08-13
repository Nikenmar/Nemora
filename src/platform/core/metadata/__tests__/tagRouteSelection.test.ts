import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const invoke = jest.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();
jest.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...(args as [string])) }));

import { onTagFileWritten } from '../../tags/events';
import { TauriMetadataFilePort } from '../tauriMetadataFilePort';
import type { MetadataFileData, MetadataFilePort, MetadataTagPatch } from '../types';

/**
 * Which route ran, asserted directly.
 *
 * Both halves of this have failed silently in this codebase before: a native
 * route that stopped being taken, and a fallback that was never reached. The
 * artwork and lyrics carve-out matters most - those still belong to TagLib, and
 * a patch that quietly went native would rewrite picture frames with code that
 * was never asked to.
 */
class RecordingFallback implements MetadataFilePort {
  readonly reads: string[] = [];
  readonly writes: { path: string; patch: MetadataTagPatch }[] = [];
  readonly heals: string[] = [];

  async read(path: string): Promise<MetadataFileData> {
    this.reads.push(path);
    return { artists: [], albumArtists: [], genres: [], duration: 1 };
  }

  async write(path: string, patch: MetadataTagPatch): Promise<void> {
    this.writes.push({ path, patch });
  }

  async healBlankPictureMime(path: string): Promise<void> {
    this.heals.push(path);
  }
}

const stats = async () => ({ createdDate: 1, modifiedDate: 2 });
const logger = { error: jest.fn() };

describe('tag route selection', () => {
  let fallback: RecordingFallback;

  beforeEach(() => {
    invoke.mockReset();
    logger.error.mockReset();
    fallback = new RecordingFallback();
  });

  const port = () => new TauriMetadataFilePort(fallback, stats, logger);

  test('reads natively and keeps the file dates the caller already had', async () => {
    invoke.mockResolvedValue({
      title: 'MONTAGEM GUERREIRO',
      artists: ['Avenxir', 'SUNJI'],
      albumArtists: ['Avenxir'],
      genres: ['Electro'],
      duration: 66.48,
      pictureMimeType: 'image/jpeg',
      pictureBytes: [1, 2, 3]
    });

    const data = await port().read('E:\\music\\song.flac');

    expect(invoke).toHaveBeenCalledWith('tags_read', {
      path: 'E:\\music\\song.flac',
      includePicture: true
    });
    expect(data.title).toBe('MONTAGEM GUERREIRO');
    expect(data.artists).toEqual(['Avenxir', 'SUNJI']);
    expect(data.picture?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(data.createdDate).toBe(1);
    expect(fallback.reads).toHaveLength(0);
  });

  test('a blank picture MIME is reported as it is on disk, not guessed', async () => {
    invoke.mockResolvedValue({
      artists: [],
      albumArtists: [],
      genres: [],
      duration: 1,
      pictureMimeType: '',
      pictureBytes: [9]
    });

    const data = await port().read('E:\\music\\blank.flac');

    // The value stands in for "the file says nothing", and the repair step is
    // what fixes it - the reader does not paper over it.
    expect(data.picture?.mimeType).toBe('image/jpeg');
  });

  test('artwork and lyrics edits stay with TagLib', async () => {
    const target = port();

    await target.write('E:\\a.mp3', { artwork: { kind: 'remove' } });
    await target.write('E:\\b.mp3', { synchronizedLyrics: '[00:01.00]line' });
    await target.write('E:\\c.mp3', { unsynchronizedLyrics: 'line' });

    expect(invoke).not.toHaveBeenCalled();
    expect(fallback.writes.map((entry) => entry.path)).toEqual([
      'E:\\a.mp3',
      'E:\\b.mp3',
      'E:\\c.mp3'
    ]);
  });

  test('a plain field edit goes native', async () => {
    invoke.mockResolvedValue(undefined);

    await port().write('E:\\a.mp3', { title: 'new', artists: ['A', 'B'] });

    expect(invoke).toHaveBeenCalledWith('tags_write', {
      path: 'E:\\a.mp3',
      patch: expect.objectContaining({ title: 'new', artists: ['A', 'B'] })
    });
    expect(fallback.writes).toHaveLength(0);
  });

  test('a missing command disables the native route for the session', async () => {
    invoke.mockRejectedValue(new Error('tags_read not found'));
    const target = port();

    await target.read('E:\\one.flac');
    await target.read('E:\\two.flac');

    // One attempt, then TagLib for both - not one failed invoke per file.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fallback.reads).toEqual(['E:\\one.flac', 'E:\\two.flac']);
    expect(logger.error).toHaveBeenCalled();
  });

  test('a failure on one file falls back for that file only', async () => {
    const target = port();
    invoke.mockRejectedValueOnce(new Error('cannot read E:\\broken.flac: unsupported'));
    invoke.mockResolvedValueOnce({ artists: [], albumArtists: [], genres: [], duration: 3 });

    await target.read('E:\\broken.flac');
    const second = await target.read('E:\\fine.flac');

    expect(fallback.reads).toEqual(['E:\\broken.flac']);
    expect(second.duration).toBe(3);
    expect(logger.error).toHaveBeenCalled();
  });

  test('a native write announces itself so the folder watcher stays quiet', async () => {
    const announced: { path: string; reason: string }[] = [];
    const stop = onTagFileWritten((event) => announced.push(event));
    invoke.mockResolvedValue(undefined);

    try {
      await port().write('E:\music\song.mp3', { title: 'new' });
    } finally {
      stop();
    }

    // Without this the app sees its own edit as an outside change and re-scans
    // the file mid-write: the first edit fails and the second appears to work.
    expect(announced).toEqual([{ path: 'E:\music\song.mp3', reason: 'native-tag-edit' }]);
  });

  test('a repair that changed nothing announces nothing', async () => {
    const announced: unknown[] = [];
    const stop = onTagFileWritten((event) => announced.push(event));
    invoke.mockResolvedValueOnce(0);

    try {
      await port().healBlankPictureMime('E:\music\fine.flac');
    } finally {
      stop();
    }

    expect(announced).toHaveLength(0);
  });

  test('repairing a blank picture MIME goes native and falls back on failure', async () => {
    const target = port();
    invoke.mockResolvedValueOnce(1);
    await target.healBlankPictureMime('E:\\ok.flac');
    expect(fallback.heals).toHaveLength(0);

    invoke.mockRejectedValueOnce(new Error('cannot write repaired pictures'));
    await target.healBlankPictureMime('E:\\locked.flac');
    expect(fallback.heals).toEqual(['E:\\locked.flac']);
  });
});
