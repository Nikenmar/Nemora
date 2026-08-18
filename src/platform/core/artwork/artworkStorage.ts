import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, remove, stat } from '@tauri-apps/plugin-fs';

import { profilePath, songCoversDir } from '../../contracts/paths';
import { TauriAtomicArtworkWriter, type ArtworkWriter } from './atomicArtworkWriter';

export interface DefaultArtworkUrls {
  album: string;
  playlist: string;
  song: string;
}

export interface ArtworkStorage {
  writer: ArtworkWriter;
  coverPath(fileName: string): Promise<string>;
  tempPath(fileName: string): Promise<string>;
  ensureCoversDirectory(): Promise<void>;
  ensureTempDirectory(): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  clearTempDirectory(olderThan?: Date): Promise<void>;
  toArtworkUrl(path: string): string;
  defaultArtworkUrl(type: QueueTypes): string;
}

export class TauriArtworkStorage implements ArtworkStorage {
  readonly writer: ArtworkWriter;
  private readonly defaults: DefaultArtworkUrls;

  constructor(
    defaults: DefaultArtworkUrls,
    writer: ArtworkWriter = new TauriAtomicArtworkWriter()
  ) {
    this.defaults = defaults;
    this.writer = writer;
  }

  async coverPath(fileName: string): Promise<string> {
    return join(await songCoversDir(), fileName);
  }

  async tempPath(fileName: string): Promise<string> {
    return join(await profilePath('temp_artworks'), fileName);
  }

  async ensureCoversDirectory(): Promise<void> {
    const directory = await songCoversDir();
    if (!(await exists(directory))) await mkdir(directory, { recursive: true });
  }

  async ensureTempDirectory(): Promise<void> {
    const directory = await profilePath('temp_artworks');
    if (!(await exists(directory))) await mkdir(directory, { recursive: true });
  }

  exists(path: string): Promise<boolean> {
    return exists(path);
  }

  async remove(path: string): Promise<void> {
    if (await exists(path)) await remove(path);
  }

  /**
   * Empties the temporary-artwork directory.
   *
   * `olderThan` keeps the sweep off anything this run produced. A temp cover
   * belongs to a song opened from outside the library, and one of those can be
   * created during startup itself - "Open with" hands the app a file before the
   * interface is even up. Without the guard, a cleanup racing that path would
   * delete the cover of the track the user is looking at. A file whose
   * timestamp cannot be read is left alone for the same reason.
   */
  async clearTempDirectory(olderThan?: Date): Promise<void> {
    const directory = await profilePath('temp_artworks');
    if (!(await exists(directory))) return;

    const cutoff = olderThan?.getTime();
    const entries = await readDir(directory);
    for (const entry of entries) {
      const path = await join(directory, entry.name);
      if (cutoff !== undefined) {
        const modified = await stat(path)
          .then((info) => info.mtime?.getTime() ?? info.birthtime?.getTime())
          .catch(() => undefined);
        if (modified === undefined || modified >= cutoff) continue;
      }
      await remove(path, { recursive: entry.isDirectory });
    }
  }

  toArtworkUrl(path: string): string {
    return convertFileSrc(path, 'nemora');
  }

  defaultArtworkUrl(type: QueueTypes): string {
    if (type === 'playlist') return this.defaults.playlist;
    if (type === 'album') return this.defaults.album;
    return this.defaults.song;
  }
}
