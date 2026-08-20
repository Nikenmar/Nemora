import { describe, expect, test } from '@jest/globals';

import { planPictureRepair, sniffPictureFormat } from '../pictureFormat';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const padded = (...values: number[]): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(values);
  return out;
};
const text = (value: string): Uint8Array => new Uint8Array([...value].map((c) => c.charCodeAt(0)));

describe('a picture is identified by its bytes, never by the string next to it', () => {
  test('the formats a demuxer accepts', () => {
    expect(sniffPictureFormat(padded(0xff, 0xd8, 0xff))).toBe('jpeg');
    expect(sniffPictureFormat(padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffPictureFormat(text('GIF89a-------------'))).toBe('gif');
    expect(sniffPictureFormat(text('BM------------------'))).toBe('bmp');
    expect(sniffPictureFormat(padded(0x49, 0x49, 0x2a, 0x00))).toBe('tiff');
    expect(sniffPictureFormat(padded(0x4d, 0x4d, 0x00, 0x2a))).toBe('tiff');
  });

  test('WebP and AVIF are real images the demuxer still refuses', () => {
    expect(sniffPictureFormat(text('RIFF0000WEBPVP8 '))).toBe('foreign');
    expect(sniffPictureFormat(text('0000ftypavif0000'))).toBe('foreign');
  });

  test('anything else is not an image', () => {
    // 357 bytes of XML in a cover frame is not a thought experiment: one sits
    // in an ordinary MP3 in the library this was written against.
    expect(sniffPictureFormat(text('<?xml version="1.0" encoding="UTF-8"?>'))).toBe('not-an-image');
    expect(sniffPictureFormat(bytes(1, 2, 3))).toBe('not-an-image');
    expect(sniffPictureFormat(new Uint8Array())).toBe('not-an-image');
  });
});

describe('the repair covers every way a declared MIME type goes wrong', () => {
  const jpeg = padded(0xff, 0xd8, 0xff);
  const png = padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  test('a picture that already says what it is is left alone', () => {
    expect(planPictureRepair(jpeg, 'image/jpeg')).toEqual({ action: 'keep' });
    expect(planPictureRepair(png, 'IMAGE/PNG ')).toEqual({ action: 'keep' });
  });

  test('absent and blank are repaired to what the bytes really are', () => {
    expect(planPictureRepair(png, undefined)).toEqual({
      action: 'set-mime',
      mimeType: 'image/png'
    });
    expect(planPictureRepair(png, '   ')).toEqual({ action: 'set-mime', mimeType: 'image/png' });
  });

  test('a blank PNG does not come back claiming to be a JPEG', () => {
    // The old repair stamped image/jpeg on everything blank. That fixes the
    // container open and leaves a cover no decoder can read.
    expect(planPictureRepair(png, '')).not.toEqual({ action: 'set-mime', mimeType: 'image/jpeg' });
  });

  test('a MIME type that is present but unknown is still broken', () => {
    expect(planPictureRepair(jpeg, 'image/webp')).toEqual({
      action: 'set-mime',
      mimeType: 'image/jpeg'
    });
  });

  test('a MIME type that names the wrong format is corrected', () => {
    expect(planPictureRepair(png, 'image/jpeg')).toEqual({
      action: 'set-mime',
      mimeType: 'image/png'
    });
  });

  test('what cannot be made acceptable is removed rather than left to kill playback', () => {
    expect(planPictureRepair(text('RIFF0000WEBPVP8 '), 'image/webp')).toEqual({
      action: 'remove',
      reason: 'foreign-format'
    });
    expect(planPictureRepair(text('<?xml version="1.0"?><x/>'), 'image/jpeg')).toEqual({
      action: 'remove',
      reason: 'not-an-image'
    });
    expect(planPictureRepair(new Uint8Array(), 'image/jpeg')).toEqual({
      action: 'remove',
      reason: 'empty'
    });
  });
});
