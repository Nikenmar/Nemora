import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';

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
  clearTempDirectory(): Promise<void>;
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

  async clearTempDirectory(): Promise<void> {
    const directory = await profilePath('temp_artworks');
    if (!(await exists(directory))) return;

    const entries = await readDir(directory);
    for (const entry of entries) {
      await remove(await join(directory, entry.name), { recursive: entry.isDirectory });
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
