import { describe, expect, test } from '@jest/globals';

import { applyTagLibPatch, type WritableTagFile } from '../tagLibPatch';

const fileWith = (overrides: Partial<WritableTagFile['tag']> = {}): WritableTagFile => ({
  tag: {
    title: 'Original Title',
    performers: ['Original Artist'],
    albumArtists: ['Original Album Artist'],
    composers: ['Original Composer'],
    album: 'Original Album',
    genres: ['Original Genre'],
    year: 1999,
    track: 3,
    lyrics: 'original lyrics',
    pictures: ['original picture'],
    ...overrides
  }
});

describe('applying an edit to a TagLib tag', () => {
  test('writes only the fields the patch mentions', () => {
    const file = fileWith();

    applyTagLibPatch(file, { title: 'New Title', trackNumber: 11 });

    expect(file.tag.title).toBe('New Title');
    expect(file.tag.track).toBe(11);
    // Everything absent from the patch is somebody else's business: the editor
    // sends what changed, and a writer that filled in the rest with blanks
    // would erase tags the user never opened.
    expect(file.tag.album).toBe('Original Album');
    expect(file.tag.performers).toEqual(['Original Artist']);
    expect(file.tag.pictures).toEqual(['original picture']);
    expect(file.tag.lyrics).toBe('original lyrics');
  });

  test('clears a field that is present but empty', () => {
    const file = fileWith();

    applyTagLibPatch(file, { title: '', genres: [], year: undefined, composer: '' });

    // Emptying a box in the editor means "remove this tag", and the value alone
    // cannot say that - only the presence of the key can.
    expect(file.tag.title).toBe('');
    expect(file.tag.genres).toEqual([]);
    expect(file.tag.year).toBe(0);
    expect(file.tag.composers).toEqual([]);
  });

  test('replaces the cover rather than adding to it, and removes it on null', () => {
    const replaced = fileWith();
    applyTagLibPatch(replaced, { picture: 'new picture' });
    expect(replaced.tag.pictures).toEqual(['new picture']);

    const removed = fileWith();
    applyTagLibPatch(removed, { picture: null });
    expect(removed.tag.pictures).toEqual([]);
  });

  test('puts the single composer field into the tag list', () => {
    const file = fileWith();

    applyTagLibPatch(file, { composer: 'One Composer' });

    expect(file.tag.composers).toEqual(['One Composer']);
  });
});
