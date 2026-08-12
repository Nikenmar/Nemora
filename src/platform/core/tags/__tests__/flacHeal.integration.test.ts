import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

import { File as TagLibFile, ReadStyle } from 'node-taglib-sharp';

import type { TagFileIo } from '../io';
import { MemoryFileAbstraction } from '../memoryFileAbstraction';
import { healBlankFlacPictureMime } from '../tagLib';

const sourceFixture = 'E:\\tmp\\nora-tags-fixtures\\source.flac';
const blankMimeFixture = 'E:\\tmp\\nora-tags-fixtures\\blank-mime.flac';
const describeWithRealFixture = existsSync(sourceFixture) ? describe : describe.skip;

const pictureMimes = (path: string, contents: Uint8Array): string[] => {
  const abstraction = new MemoryFileAbstraction(path, contents);
  const file = TagLibFile.createFromAbstraction(abstraction, undefined, ReadStyle.None);
  try {
    return file.tag.pictures.map((picture) => picture.mimeType);
  } finally {
    file.dispose();
  }
};

describeWithRealFixture('FLAC blank picture MIME healing over an E:\\tmp copy', () => {
  test('constructs a genuinely blank MIME block, validates, and atomically replaces it', async () => {
    const source = await readFile(sourceFixture);
    const abstraction = new MemoryFileAbstraction(blankMimeFixture, source);
    const file = TagLibFile.createFromAbstraction(abstraction);
    try {
      expect(file.tag.pictures.length).toBeGreaterThan(0);
      file.tag.pictures[0].mimeType = '';
      file.save();
    } finally {
      file.dispose();
    }
    await writeFile(blankMimeFixture, abstraction.snapshot());
    expect(pictureMimes(blankMimeFixture, await readFile(blankMimeFixture))[0]).toBe('');

    let atomicWrites = 0;
    const io: TagFileIo = {
      read: async (path) => readFile(path),
      writeAtomic: async (path, contents) => {
        atomicWrites += 1;
        const temporary = `${path}.test-atomic.tmp`;
        await writeFile(temporary, contents);
        await rm(path, { force: true });
        await rename(temporary, path);
      }
    };

    const result = await healBlankFlacPictureMime(blankMimeFixture, {
      io,
      validate: async (path, contents) => {
        const validationAbstraction = new MemoryFileAbstraction(path, contents);
        const validationFile = TagLibFile.createFromAbstraction(validationAbstraction);
        try {
          expect(validationFile.isPossiblyCorrupt).toBe(false);
          expect(validationFile.tag.pictures.length).toBeGreaterThan(0);
        } finally {
          validationFile.dispose();
        }
      }
    });
    expect(result).toEqual({ healed: true, healedPictureCount: 1 });
    expect(atomicWrites).toBe(1);
    expect(pictureMimes(blankMimeFixture, await readFile(blankMimeFixture))[0]).toBe('image/jpeg');
  }, 120_000);
});
