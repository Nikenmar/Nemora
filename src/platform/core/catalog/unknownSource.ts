import { embeddedArtwork } from '../artwork';
import { METADATA_HEAD_SIZE, SUPPORTED_MUSIC_EXTENSIONS } from '../library/constants';
import { extensionOf } from '../library/path';
import type { LibraryFileSystemPort, MetadataParserPort, ParsedPicture } from '../library/types';
import { generateRandomId } from '../playlists/randomId';
import { titleFromPath } from './path';

export type PathBackedAudioData = Omit<AudioPlayerData, 'artwork'> & { artwork?: string };

export interface UnknownSourceRepository {
  findKnownSongId(path: string): string | undefined;
  getKnownSong(songId: string): Promise<PathBackedAudioData>;
  createTempArtwork(source: ReturnType<typeof embeddedArtwork>): Promise<string | undefined>;
  resolveFilePath(path: string): string;
  defaultSongArtwork(): string;
  rememberOutsideSong(song: PathBackedAudioData): void;
  sendMessage(code: MessageCodes, data?: MessageToRendererData): void;
}

const pictureMimeType = (picture: ParsedPicture): string => {
  const format = picture.format.toLocaleLowerCase('en-US');
  if (format.includes('/')) return format;
  if (format === 'jpg') return 'image/jpeg';
  return format ? `image/${format}` : 'application/octet-stream';
};

export class UnsupportedAudioSourceError extends Error {
  constructor(path: string) {
    super(`Unsupported audio file extension: ${path}`);
    this.name = 'UnsupportedAudioSourceError';
  }
}

export const getSongFromUnknownSource = async (
  repository: UnknownSourceRepository,
  fileSystem: LibraryFileSystemPort,
  parser: MetadataParserPort,
  songPath: string
): Promise<PathBackedAudioData> => {
  if (!(SUPPORTED_MUSIC_EXTENSIONS as readonly string[]).includes(extensionOf(songPath))) {
    throw new UnsupportedAudioSourceError(songPath);
  }

  const knownSongId = repository.findKnownSongId(songPath);
  if (knownSongId) return repository.getKnownSong(knownSongId);

  const [stats, head] = await Promise.all([
    fileSystem.stat(songPath),
    fileSystem.readHead(songPath, METADATA_HEAD_SIZE)
  ]);
  if (!stats.isFile) throw new Error(`Unknown audio source is not a file: ${songPath}`);
  const headCopy = new Uint8Array(head.byteLength);
  headCopy.set(head);
  const metadata = await parser.parse(songPath, headCopy.buffer, true);
  const picture = metadata.pictures.find((candidate) => candidate.data);
  const temporaryArtworkPath = picture?.data
    ? await repository.createTempArtwork(
        embeddedArtwork(new Uint8Array(picture.data), pictureMimeType(picture))
      )
    : undefined;
  const artworkPath = temporaryArtworkPath
    ? repository.resolveFilePath(temporaryArtworkPath)
    : repository.defaultSongArtwork();
  const artistNames = metadata.common.artist
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const data: PathBackedAudioData = {
    songId: generateRandomId(),
    title: metadata.common.title?.trim() || titleFromPath(songPath) || 'Unknown Title',
    artists: artistNames?.map((name) => ({ artistId: '', name })),
    duration: metadata.format.duration ?? 0,
    artwork: artworkPath,
    artworkPath,
    path: repository.resolveFilePath(songPath),
    isAFavorite: false,
    isKnownSource: false,
    isBlacklisted: false
  };
  repository.rememberOutsideSong(data);
  repository.sendMessage('PLAYBACK_FROM_UNKNOWN_SOURCE');
  return data;
};

