import type { PathBackedUpdateSongDataResult } from './binary';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getRuntime } from '../runtime';
import { emitLocal } from './events';

const saveArtworkToSystem = (artworkPath: string, saveName?: string): void => {
  void saveDialog({
    title: 'Select the destination to save the artwork',
    defaultPath: saveName || 'artwork',
    filters: [{ name: 'Image files', extensions: ['png', 'jpeg', 'webp', 'avif', 'tiff', 'gif'] }]
  })
    .then(async (destination) => {
      if (typeof destination !== 'string') {
        emitLocal('app/sendMessageToRendererEvent', 'DESTINATION_NOT_SELECTED');
        return;
      }
      await getRuntime().saveArtwork(artworkPath, destination);
      emitLocal('app/sendMessageToRendererEvent', 'ARTWORK_SAVED');
    })
    .catch((error: unknown) => {
      console.error('Failed to save artwork.', error);
      emitLocal('app/sendMessageToRendererEvent', 'ARTWORK_SAVE_FAILED');
    });
};

export const songUpdates = {
  updateSongId3Tags: (
    songIdOrPath: string,
    tags: SongTags,
    sendUpdatedData: boolean,
    isKnownSource: boolean
  ): Promise<PathBackedUpdateSongDataResult> =>
    getRuntime().updateSongId3Tags(songIdOrPath, tags, sendUpdatedData, isKnownSource),
  reParseSong: (songPath: string): Promise<SavableSongData | undefined> =>
    getRuntime().reParseSong(songPath),
  /**
   * Repairs the embedded-picture defect that makes the webview refuse a file,
   * resolving true only when something was actually repaired and the track is
   * therefore worth retrying.
   */
  healSongForPlayback: (songId: string): Promise<boolean> =>
    getRuntime().healSongForPlayback(songId),
  getSongId3Tags: (songIdOrPath: string, isKnownSource: boolean): Promise<SongTags> =>
    getRuntime().getSongTags(songIdOrPath, isKnownSource),
  getImgFileLocation: async (): Promise<string> => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'webp', 'png'] }]
    });
    if (typeof selected !== 'string') throw new Error('PROMPT_CLOSED_BEFORE_INPUT');
    return selected;
  },
  revealSongInFileExplorer: (songId: string): void => {
    void getRuntime()
      .revealSongInFileExplorer(songId)
      .catch((error: unknown) => console.error('Failed to reveal song in Explorer.', error));
  },
  saveArtworkToSystem,
  isMetadataUpdatesPending: async (songPath: string): Promise<boolean> =>
    getRuntime().isMetadataUpdatesPending(songPath)
};
