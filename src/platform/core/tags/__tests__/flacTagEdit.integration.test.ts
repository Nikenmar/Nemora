import { existsSync } from 'node:fs';
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { File as TagLibFile, ReadStyle } from 'node-taglib-sharp';

import type { TagFileIo } from '../io';
import { MemoryFileAbstraction } from '../memoryFileAbstraction';
import { updateTagLibFile } from '../tagLib';
import { applyTagLibPatch, createTagLibPicture } from '../tagLibPatch';

/**
 * Editing a FLAC end to end, against a real file.
 *
 * This is the check that could not be faked. The editor was limited to MP3
 * because the writer behind it was node-id3, which speaks ID3 and therefore
 * MP3; pointing it at a FLAC would have written an ID3 block into a Vorbis
 * container. Whether TagLib really writes a FLAC that TagLib can read back is
 * the one thing a mocked test cannot answer, so this reads the file it wrote.
 */
const sourceFixture = 'E:\\tmp\\nora-tags-fixtures\\source.flac';
const editedFixture = 'E:\\tmp\\nora-tags-fixtures\\edited.flac';
const describeWithRealFixture = existsSync(sourceFixture) ? describe : describe.skip;

const io: TagFileIo = {
  read: async (path) => readFile(path),
  writeAtomic: async (path, contents) => {
    const temporary = `${path}.test-atomic.tmp`;
    await writeFile(temporary, contents);
    await rm(path, { force: true });
    await rename(temporary, path);
  }
};

/**
 * The production validator parses the candidate with `music-metadata`, which
 * jest cannot resolve here - it is ESM-only, and the same substitution is made
 * by the blank-MIME test next door. TagLib re-parsing the bytes is the check
 * that matters for this one anyway, and every assertion below is made against
 * the file after it was committed to disk.
 */
const validate = async (path: string, contents: Uint8Array): Promise<void> => {
  const abstraction = new MemoryFileAbstraction(path, contents);
  const parsed = TagLibFile.createFromAbstraction(abstraction);
  try {
    expect(parsed.isPossiblyCorrupt).toBe(false);
  } finally {
    parsed.dispose();
  }
};

const readBack = async (path: string) => {
  const file = TagLibFile.createFromPath(path, undefined, ReadStyle.None);
  try {
    const picture = file.tag.pictures.at(0);
    return {
      title: file.tag.title,
      performers: [...file.tag.performers],
      album: file.tag.album,
      genres: [...file.tag.genres],
      year: file.tag.year,
      track: file.tag.track,
      lyrics: file.tag.lyrics,
      pictureCount: file.tag.pictures.length,
      pictureMime: picture?.mimeType,
      pictureBytes: picture?.data.length ?? 0,
      corrupt: file.isPossiblyCorrupt
    };
  } finally {
    file.dispose();
  }
};

describeWithRealFixture('editing tags on a real FLAC', () => {
  test('writes text, lyrics and a cover, and reads every one of them back', async () => {
    await copyFile(sourceFixture, editedFixture);
    const before = await readBack(editedFixture);

    // A tiny but valid PNG: the point is that the bytes survive the round trip
    // with their MIME intact, not what they depict.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);

    await updateTagLibFile(
      editedFixture,
      (file) =>
        applyTagLibPatch(file as never, {
          title: 'Edited By Nemora',
          artists: ['First Artist', 'Second Artist'],
          album: 'Edited Album',
          genres: ['Ambient'],
          year: 2026,
          trackNumber: 7,
          composer: 'A Composer',
          lyrics: '[00:01.00]a synced line\n[00:02.00]another',
          picture: createTagLibPicture(png, 'image/png')
        }),
      { io, validate }
    );

    const after = await readBack(editedFixture);

    expect(after.title).toBe('Edited By Nemora');
    expect(after.performers).toEqual(['First Artist', 'Second Artist']);
    expect(after.album).toBe('Edited Album');
    expect(after.genres).toEqual(['Ambient']);
    expect(after.year).toBe(2026);
    expect(after.track).toBe(7);
    expect(after.lyrics).toContain('[00:01.00]a synced line');
    // Replaced, not appended: the fixture already carries a cover, and a file
    // that gained one per edit would grow by a megabyte every time.
    expect(after.pictureCount).toBe(1);
    expect(after.pictureMime).toBe('image/png');
    expect(after.pictureBytes).toBe(png.length);
    expect(after.corrupt).toBe(false);
    // The edit landed on THIS file rather than on nothing at all.
    expect(after.title).not.toBe(before.title);

    await rm(editedFixture, { force: true });
  }, 120_000);

  test('clears a field the editor emptied instead of leaving the old value', async () => {
    await copyFile(sourceFixture, editedFixture);

    await updateTagLibFile(
      editedFixture,
      (file) => applyTagLibPatch(file as never, { album: '', genres: [], picture: null }),
      { io, validate }
    );

    const after = await readBack(editedFixture);
    expect(after.album).toBeFalsy();
    expect(after.genres).toEqual([]);
    expect(after.pictureCount).toBe(0);
    expect(after.corrupt).toBe(false);

    await rm(editedFixture, { force: true });
  }, 120_000);
});
