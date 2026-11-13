import { describe, expect, it } from 'vitest';
import { utils } from '@platform/api/utils';

describe('localPathFromAssetUrl', () => {
  it('reads the file behind the media URL the player plays', () => {
    const path = String.raw`E:\Music\夜に駆ける (Live) #1.flac`;
    const url = `http://nemora.localhost/${encodeURIComponent(path)}`;
    expect(utils.localPathFromAssetUrl(url)).toBe(path);
    expect(utils.getBaseName(utils.localPathFromAssetUrl(url))).toBe('夜に駆ける (Live) #1.flac');
  });

  it('drops a query and the legacy localfiles namespace', () => {
    expect(utils.localPathFromAssetUrl('http://nemora.localhost/localfiles/E%3A%5Ca.mp3?ts=1')).toBe(
      String.raw`E:\a.mp3`
    );
  });

  it('passes a plain path through', () => {
    expect(utils.localPathFromAssetUrl(String.raw`E:\Music\a.flac`)).toBe(String.raw`E:\Music\a.flac`);
  });
});
