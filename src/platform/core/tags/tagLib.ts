import { File as TagLibFile, ReadStyle } from 'node-taglib-sharp';

import { TagIoError } from './errors';
import { emitTagFileWritten } from './events';
import { commitTagFile, readTagFile, type TagFileIo, tauriTagFileIo } from './io';
import { MemoryFileAbstraction } from './memoryFileAbstraction';
import { withTagPathLock } from './pathLock';
import { planPictureRepair } from './pictureFormat';
import { validateTagLibCandidate, type CandidateValidator } from './validation';

export type TagLibMutation = (file: TagLibFile) => void;

export type TagLibWriteOptions = {
  io?: TagFileIo;
  validate?: CandidateValidator;
};

export type FlacMimeHealResult = {
  healed: boolean;
  healedPictureCount: number;
};

/** Reads a TagLib file from memory and disposes it after the synchronous projection. */
export async function readTagLibFile<T>(
  path: string,
  project: (file: TagLibFile) => T,
  io: TagFileIo = tauriTagFileIo
): Promise<T> {
  const contents = await readTagFile(path, io);
  let file: TagLibFile | undefined;
  try {
    const abstraction = new MemoryFileAbstraction(path, contents);
    file = TagLibFile.createFromAbstraction(abstraction, undefined, ReadStyle.Average);
    if (file.isPossiblyCorrupt) {
      throw new TagIoError(
        'corrupt-input',
        path,
        `TagLib marked the file as possibly corrupt (${file.corruptionReasons.join('; ')})`
      );
    }
  } catch (cause) {
    if (cause instanceof TagIoError) throw cause;
    // The byte count belongs in the message: a parse that fails on fewer bytes
    // than the file holds is a truncated read, not a broken file, and the two
    // have nothing in common except the error they used to share.
    throw new TagIoError(
      'parse-failed',
      path,
      `TagLib buffer parse failed over ${contents.byteLength} bytes`,
      cause
    );
  }

  // Projecting is NOT parsing. Keeping it inside the block above reported every
  // failure of the caller's own callback as a corrupt file.
  try {
    return project(file);
  } finally {
    file.dispose();
  }
}

const buildTagLibCandidate = (
  path: string,
  original: Uint8Array,
  mutate: TagLibMutation
): Uint8Array => {
  const abstraction = new MemoryFileAbstraction(path, original);
  let file: TagLibFile | undefined;
  try {
    file = TagLibFile.createFromAbstraction(abstraction, undefined, ReadStyle.Average);
    if (file.isPossiblyCorrupt) {
      throw new TagIoError(
        'corrupt-input',
        path,
        `TagLib refused to write a possibly corrupt file (${file.corruptionReasons.join('; ')})`
      );
    }
    mutate(file);
    file.save();
    return abstraction.snapshot();
  } catch (cause) {
    if (cause instanceof TagIoError) throw cause;
    throw new TagIoError('mutation-failed', path, 'TagLib buffer mutation failed', cause);
  } finally {
    file?.dispose();
  }
};

/** Whole-file TagLib transaction: async read, memory mutation, validation, atomic commit. */
export function updateTagLibFile(
  path: string,
  mutate: TagLibMutation,
  options: TagLibWriteOptions = {}
): Promise<void> {
  const io = options.io ?? tauriTagFileIo;
  const validate = options.validate ?? validateTagLibCandidate;
  return withTagPathLock(path, async () => {
    const original = await readTagFile(path, io);
    const candidate = buildTagLibCandidate(path, original, mutate);
    await validate(path, candidate);
    await commitTagFile(path, candidate, io);
    emitTagFileWritten({ path, reason: 'taglib-edit' });
  });
}

/**
 * Makes every embedded picture something a media pipeline will open.
 *
 * The fork's founding defect was one member of a family, and only that one
 * member was ever repaired: a picture with a blank MIME type, rewritten as
 * `image/jpeg`. FFmpeg fails a container open the same way for a MIME type it
 * simply does not know (`image/webp`, which this app can itself produce), and
 * the blanket `image/jpeg` was its own small lie whenever the bytes were a PNG.
 * `planPictureRepair` decides from the bytes instead; see it for the rule.
 *
 * This is the route taken only when the native repair is unavailable. It has no
 * image codec to re-encode a WebP cover with, so where Rust converts, this
 * drops - the song is worth more than the embedded copy of a cover the app
 * already holds in its own store.
 */
export function healBlankFlacPictureMime(
  path: string,
  options: TagLibWriteOptions = {}
): Promise<FlacMimeHealResult> {
  const io = options.io ?? tauriTagFileIo;
  const validate = options.validate ?? validateTagLibCandidate;
  return withTagPathLock(path, async () => {
    const original = await readTagFile(path, io);
    let healedPictureCount = 0;
    const candidate = buildTagLibCandidate(path, original, (file) => {
      const kept: unknown[] = [];
      for (const picture of file.tag.pictures) {
        const repair = planPictureRepair(picture.data.toByteArray(), picture.mimeType);
        if (repair.action === 'keep') {
          kept.push(picture);
          continue;
        }
        healedPictureCount += 1;
        if (repair.action === 'set-mime') {
          picture.mimeType = repair.mimeType;
          kept.push(picture);
        }
        // 'remove': simply not carried over into `kept`.
      }
      if (healedPictureCount > 0) file.tag.pictures = kept as typeof file.tag.pictures;
    });

    if (healedPictureCount === 0) return { healed: false, healedPictureCount: 0 };

    await validate(path, candidate);

    // The fresh parse above proves structural validity; assert the actual repair too.
    const check = new MemoryFileAbstraction(path, candidate);
    let parsed: TagLibFile | undefined;
    try {
      parsed = TagLibFile.createFromAbstraction(check, undefined, ReadStyle.None);
      const stillBroken = parsed.tag.pictures.some(
        (picture) => planPictureRepair(picture.data.toByteArray(), picture.mimeType).action !== 'keep'
      );
      if (stillBroken) {
        throw new TagIoError(
          'validation-failed',
          path,
          'candidate still contains a picture a demuxer would refuse; original file was not changed'
        );
      }
    } finally {
      parsed?.dispose();
    }

    await commitTagFile(path, candidate, io);
    emitTagFileWritten({ path, reason: 'flac-picture-mime-heal' });
    return { healed: true, healedPictureCount };
  });
}
