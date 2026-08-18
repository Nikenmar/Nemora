import { getVersion } from '@tauri-apps/api/app';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { executableDir } from '@tauri-apps/api/path';
import { copyFile, exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs';
import { createDefaultNoraImportPort } from '../core/import/noraImportRepository';
import { relaunch } from '@tauri-apps/plugin-process';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  debug as logDebug,
  error as logError,
  info as logInfo,
  warn as logWarn
} from '@tauri-apps/plugin-log';
import { Buffer } from 'buffer/';

import albumCover from '../../renderer/src/assets/images/webp/album_cover_default.webp';
import artistCover from '../../renderer/src/assets/images/webp/artist_cover_default.webp';
import favoritesCover from '../../renderer/src/assets/images/webp/favorites-playlist-icon.webp';
import historyCover from '../../renderer/src/assets/images/webp/history-playlist-icon.webp';
import playlistCover from '../../renderer/src/assets/images/webp/playlist_cover_default.webp';
import rediscoverCover from '../../renderer/src/assets/images/webp/rediscover-playlist-icon.webp';
import songCover from '../../renderer/src/assets/images/webp/song_cover_default.webp';
import {
  ArtworkService,
  BrowserImageBackend,
  ImageTransformer,
  PaletteGenerator,
  pathArtwork,
  TauriArtworkStorage,
  urlArtwork,
  type ArtworkLogger
} from '../core/artwork';
// Deep import, not the barrel: this module binds Tauri commands, and the barrel
// is what non-Tauri consumers of the shared core import.
import { createArtworkPipeline } from '../core/artwork/tauriPipeline';
import { TauriMetadataFilePort } from '../core/metadata/tauriMetadataFilePort';
import parseLyrics from '../../common/parseLyrics';
import convertParsedLyricsToNodeID3Format from '../core/lyrics/convertParsedLyricsToNodeID3Format';
import type { MetadataFilePort, MetadataTagPatch } from '../core/metadata';
import {
  applyTagLibPatch,
  createTagLibPicture,
  healBlankFlacPictureMime,
  onTagFileWritten,
  readNodeId3Tags,
  readTagLibFile,
  updateNodeId3Tags,
  updateTagLibFile,
  type TagLibPatch
} from '../core/tags';
import { internalWriteSuppression, tauriWatcherFileSystem } from '../core/watchers';
import { tauriLibraryFileSystem } from '../core/library/tauriFileSystem';
import type {
  AudioStreamProperties,
  MetadataParserPort,
  NativeLibraryPort,
  NativeParsedFile,
  ParsedPicture,
  WalkedDirectory
} from '../core/library/types';
import { getBuildEnvVariable } from '../core/net/buildEnv';
import { configureLogger as configureLyricsLogger } from '../core/lyrics/logger';
import { configureLogger as configureNetLogger } from '../core/net/logger';
import { configureLogger as configurePlaylistsLogger } from '../core/playlists/logger';
import { configureLogger as configureSongGuessrLogger } from '../core/songGuessr/logger';
import { configureLogger as configureRuntimeLogger } from './logger';
import { romanizeForSearch } from '../core/search/romanizeForSearch';
import { METADATA_HEAD_SIZE, SUPPORTED_MUSIC_EXTENSIONS } from '../core/library/constants';
import { createMetadataWorkerClient } from '../core/library/metadataWorkerClient';
import { removeSongReferencesFromDuels } from '../core/catalog';
import { decrypt as decryptCredential } from '../core/secrets/safeStorage';
import { profilePath, songCoversDir } from '../contracts/paths';
import {
  SECOND_INSTANCE_EVENT,
  SingleInstanceController,
  tauriEventPort,
  tauriFileArgumentPort,
  tauriWindowPort,
  type ShellEventPort
} from '../shell';
import type { RuntimeArtworkPaths } from './artwork';
import { LocalRuntimeEventSink } from './events';
import type { NoraRuntimeOptions } from './runtime';
import type { RuntimeFileServices, RuntimeServices } from './services';

const joinFile = (directory: string, fileName: string): string =>
  `${directory}${directory.endsWith('\\') || directory.endsWith('/') ? '' : directory.includes('\\') ? '\\' : '/'}${fileName}`;

const defaultPaths = (path: string): ArtworkPaths => ({
  isDefaultArtwork: true,
  artworkPath: path,
  optimizedArtworkPath: path
});

class ProductionArtworkPaths implements RuntimeArtworkPaths {
  private readonly coversDirectory: string;
  private readonly localArtworkPaths = new Map<string, string>();

  constructor(coversDirectory: string) {
    this.coversDirectory = coversDirectory;
  }

  private stored(fileName: string): string {
    const path = joinFile(this.coversDirectory, fileName);
    const url = convertFileSrc(path, 'nemora');
    this.localArtworkPaths.set(url, path);
    return url;
  }

  song(songId: string, isAvailable = true): ArtworkPaths {
    return isAvailable
      ? {
          isDefaultArtwork: false,
          artworkPath: this.stored(`${songId}.webp`),
          optimizedArtworkPath: this.stored(`${songId}-optimized.webp`)
        }
      : defaultPaths(songCover);
  }

  artist(artworkName?: string): ArtworkPaths {
    if (!artworkName) return defaultPaths(artistCover);
    return {
      isDefaultArtwork: false,
      artworkPath: this.stored(artworkName),
      optimizedArtworkPath: this.stored(artworkName.replace(/\.webp$/iu, '-optimized.webp'))
    };
  }

  album(artworkName?: string): ArtworkPaths {
    if (!artworkName) return defaultPaths(albumCover);
    return {
      isDefaultArtwork: false,
      artworkPath: this.stored(artworkName),
      optimizedArtworkPath: this.stored(artworkName.replace(/\.webp$/iu, '-optimized.webp'))
    };
  }

  genre(artworkName?: string): ArtworkPaths {
    if (!artworkName) return defaultPaths(songCover);
    return {
      isDefaultArtwork: false,
      artworkPath: this.stored(artworkName),
      optimizedArtworkPath: this.stored(artworkName.replace(/\.webp$/iu, '-optimized.webp'))
    };
  }

  playlist(playlistId: string, isAvailable: boolean): ArtworkPaths {
    if (playlistId === 'History') return defaultPaths(historyCover);
    if (playlistId === 'Favorites') return defaultPaths(favoritesCover);
    if (playlistId === 'Rediscover') return defaultPaths(rediscoverCover);
    if (!isAvailable) return defaultPaths(playlistCover);
    const path = this.stored(`${playlistId}.webp`);
    return { isDefaultArtwork: false, artworkPath: path, optimizedArtworkPath: path };
  }

  songFile(songPath: string): string {
    return convertFileSrc(songPath, 'nemora');
  }

  localPath(artworkUrl: string): string | undefined {
    return this.localArtworkPaths.get(artworkUrl);
  }
}

const productionLogger = {
  debug: (message: string, data?: unknown): void => console.debug(message, data),
  info: (message: string, data?: unknown): void => console.info(message, data),
  warn: (message: string, data?: unknown): void => console.warn(message, data),
  error: (message: string, data?: unknown): void => console.error(message, data)
};

/**
 * Renders the structured second argument for the log file.
 *
 * `JSON.stringify` turns an Error into `{}` and throws on a cycle, and the
 * interesting values here are exactly errors: a rejected Tauri command arrives
 * as a bare string, a rejected plugin call as an Error.
 */
const describeLogData = (data?: Record<string, unknown>): string => {
  if (!data) return '';
  try {
    const seen = new WeakSet<object>();
    return ` ${JSON.stringify(data, (_key, value: unknown) => {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    })}`;
  } catch {
    return ' [unserialisable log data]';
  }
};

/**
 * The core packages log through injected seams that stay silent until something
 * calls `configureLogger`. Nothing ever did, so every diagnostic the ported core
 * writes - including the reason a stats import refused to run - was discarded
 * before it reached the log file or the console.
 */
function wireCoreLoggers(): {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
} {
  const forward =
    (
      level: 'debug' | 'info' | 'warn' | 'error',
      send: (message: string) => Promise<void>,
      toConsole: (message: string, data?: unknown) => void
    ) =>
    (message: string, data?: Record<string, unknown>): void => {
      toConsole(message, data);
      // Logging must never break the caller it is reporting on.
      void send(`[core] ${message}${describeLogData(data)}`).catch((error: unknown) =>
        console.error(`Failed to write a ${level} log entry.`, error)
      );
    };

  const coreLogger = {
    debug: forward('debug', logDebug, productionLogger.debug),
    info: forward('info', logInfo, productionLogger.info),
    warn: forward('warn', logWarn, productionLogger.warn),
    error: forward('error', logError, productionLogger.error)
  };

  configurePlaylistsLogger(coreLogger);
  configureLyricsLogger(coreLogger);
  configureNetLogger(coreLogger);
  // Narrower interface: this one only ever reports errors.
  configureSongGuessrLogger({ error: coreLogger.error });
  // The runtime writes the lines that answer "did the scan reattach anything?".
  configureRuntimeLogger(coreLogger);
  return coreLogger;
}

const productionFiles: RuntimeFileServices = {
  profilePath,
  readTextFile,
  readDir: async (path) =>
    (await readDir(path)).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory })),
  writeTextFileAtomic: (path, contents) =>
    invoke<void>('write_text_file_atomic', { path, contents }),
  exists,
  makeDir: async (path, options) => {
    const exist = await exists(path);
    if (!exist) await mkdir(path, options);
    return { exist };
  },
  copyFile,
  copyFileAtomic: (source, destination) =>
    invoke<void>('copy_file_atomic', { source, destination }),
  remove: async (path, options) => {
    if (await exists(path)) await remove(path, options);
  }
};

const browserMetadataParser: MetadataParserPort = {
  parse: async (_path, head, includeArtwork = false) => {
    const { parseBuffer } = await import('music-metadata');
    const metadata = await parseBuffer(new Uint8Array(head), undefined, { duration: false });
    const pictures: ParsedPicture[] = (metadata.common.picture ?? []).map((picture) => {
      const parsed: ParsedPicture = {
        format: picture.format,
        description: picture.description,
        type: picture.type,
        name: picture.name,
        byteLength: picture.data.byteLength
      };
      if (includeArtwork) {
        const data = new Uint8Array(picture.data.byteLength);
        data.set(picture.data);
        parsed.data = data.buffer;
      }
      return parsed;
    });
    return {
      common: {
        title: metadata.common.title,
        artist: metadata.common.artist,
        albumArtist: metadata.common.albumartist,
        album: metadata.common.album,
        genres: metadata.common.genre ?? [],
        year: metadata.common.year,
        trackNumber: metadata.common.track.no ?? undefined,
        discNumber: metadata.common.disk.no ?? undefined
      },
      format: {
        container: metadata.format.container,
        codec: metadata.format.codec,
        duration: metadata.format.duration,
        sampleRate: metadata.format.sampleRate,
        bitrate: metadata.format.bitrate,
        numberOfChannels: metadata.format.numberOfChannels,
        lossless: metadata.format.lossless
      },
      pictures,
      metadataCompleteness: 'head'
    };
  }
};

/**
 * The library walk and parse, done by the host.
 *
 * Same two-tier failure rule as the artwork and tag routes: a build without
 * these commands closes the route for the session, one bad answer closes
 * nothing. Both methods answer `undefined` for "use the TypeScript route",
 * which is a cue and not an error - the scanner then reads those files exactly
 * as a browser or the Android port would.
 */
const createNativeLibrary = (forceTypeScript: boolean): NativeLibraryPort | undefined => {
  if (forceTypeScript) return undefined;
  let available = true;

  const call = async <Result>(
    command: string,
    args: Record<string, unknown>
  ): Promise<Result | undefined> => {
    if (!available) return undefined;
    try {
      return await invoke<Result>(command, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|not allowed|unknown command|missing/iu.test(message)) {
        available = false;
        productionLogger.warn('Native library scanning unavailable for this build.', { error });
      } else {
        productionLogger.warn('Native library scanning failed; using the TypeScript route.', {
          command,
          error
        });
      }
      return undefined;
    }
  };

  return {
    walk: (roots, extensions) =>
      call<WalkedDirectory[]>('library_walk', { roots: [...roots], extensions: [...extensions] }),
    parse: (paths) => call<NativeParsedFile[]>('library_parse', { paths: [...paths] })
  };
};

/**
 * Metadata parsing, moved off the UI thread and onto the worker written for it.
 *
 * `MetadataWorkerClient`, `metadata.worker.ts` and their protocol were built to
 * keep a library scan from blocking the renderer - 256 KB of `parseBuffer` per
 * file, on the same thread that draws the interface - and then nothing ever
 * constructed the client. This composes it, and keeps the in-process parser as
 * the fallback rather than the default.
 *
 * The fallback re-reads the head from disk instead of reusing the caller's
 * buffer, because a request transfers that buffer to the worker and a
 * transferred ArrayBuffer is detached: after a worker failure there is nothing
 * left to parse. A file whose metadata is genuinely unreadable therefore costs
 * one extra head read before it is reported as a scan failure, which is the
 * cheap half of the trade.
 */
const createMetadataParser = (): MetadataParserPort => {
  let worker: ReturnType<typeof createMetadataWorkerClient> | undefined;
  let workerAttempted = false;
  let nativePropertiesAvailable = true;

  // Spawned on the first parse, not at startup: a launch that never scans
  // anything should not pay for a worker, and this app measures its own
  // startup time.
  const ensureWorker = (): typeof worker => {
    if (workerAttempted) return worker;
    workerAttempted = true;
    try {
      worker = createMetadataWorkerClient();
    } catch (error) {
      productionLogger.error('Metadata worker unavailable; parsing in the renderer thread.', {
        error
      });
    }
    return worker;
  };

  const parseInProcess = async (
    path: string,
    includeArtwork: boolean
  ): ReturnType<MetadataParserPort['parse']> => {
    const head = await tauriLibraryFileSystem.readHead(path, METADATA_HEAD_SIZE);
    const copy = new Uint8Array(head.byteLength);
    copy.set(head);
    return browserMetadataParser.parse(path, copy.buffer, includeArtwork);
  };

  return {
    parse: async (path, head, includeArtwork = false) => {
      const active = ensureWorker();
      if (!active) return browserMetadataParser.parse(path, head, includeArtwork);
      try {
        return await active.parse(path, head, includeArtwork);
      } catch (error) {
        // A dead worker stays dead: every later file would pay the same failure
        // and the same re-read before falling back.
        const message = error instanceof Error ? error.message : String(error);
        if (/worker/iu.test(message)) {
          productionLogger.error('Metadata worker failed; falling back to in-thread parsing.', {
            error
          });
          worker = undefined;
        }
        return parseInProcess(path, includeArtwork);
      }
    },
    properties: async (path) => {
      if (!nativePropertiesAvailable) return undefined;
      try {
        return await invoke<AudioStreamProperties>('audio_properties', { path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A missing command is a property of the BUILD, not of the file: every
        // later call would fail identically, so the route closes for the
        // session. A file that simply cannot be read keeps the route open.
        if (/not found|not allowed|unknown command|missing/iu.test(message)) {
          nativePropertiesAvailable = false;
          productionLogger.warn('Native audio properties unavailable for this build.', { error });
        } else {
          productionLogger.warn('Could not read audio properties natively.', { path, error });
        }
        return undefined;
      }
    }
  };
};

let tagSuppressionHookInstalled = false;

const installTagSuppressionHook = (): void => {
  if (tagSuppressionHookInstalled) return;
  onTagFileWritten(({ path }) => internalWriteSuppression.suppress(path));
  tagSuppressionHookInstalled = true;
};

const createSingleInstanceService = (): NonNullable<RuntimeServices['singleInstance']> => ({
  create: async (routes) => {
    const liveDeliveries = new Map<string, number>();
    let drainingQueuedArguments = true;
    const events: ShellEventPort = {
      listen: async <Payload>(event: string, handler: (payload: Payload) => void) => {
        if (event !== SECOND_INSTANCE_EVENT) return tauriEventPort.listen(event, handler);
        const audioHandler = handler as unknown as (payload: string[]) => void;
        const unlisten = await tauriEventPort.listen<string[]>(event, (argv) => {
          if (drainingQueuedArguments) {
            const key = JSON.stringify(argv);
            liveDeliveries.set(key, (liveDeliveries.get(key) ?? 0) + 1);
          }
          audioHandler(argv);
        });
        const queued = await invoke<string[][]>('drain_pending_second_instance_args');
        for (const argv of queued) {
          const key = JSON.stringify(argv);
          const liveCount = liveDeliveries.get(key) ?? 0;
          if (liveCount > 0) {
            if (liveCount === 1) liveDeliveries.delete(key);
            else liveDeliveries.set(key, liveCount - 1);
          } else audioHandler(argv);
        }
        drainingQueuedArguments = false;
        liveDeliveries.clear();
        return unlisten;
      }
    };
    // Our own argv, which is where Windows puts the file that launched us.
    // The single-instance plugin only reports SECOND instances, so without
    // this "open with Nemora" worked while the app was already running and
    // did nothing at all from a cold start. A failure here must not stop the
    // app from opening, so it degrades to no startup file.
    const initialArgv = await invoke<string[]>('startup_args').catch((error: unknown) => {
      console.error('Could not read the startup arguments.', error);
      return [] as string[];
    });

    const controller = new SingleInstanceController(
      tauriWindowPort,
      events,
      tauriFileArgumentPort,
      routes,
      { supportedMusicExtensions: SUPPORTED_MUSIC_EXTENSIONS, initialArgv }
    );
    await controller.start();
    return controller;
  }
});

const createMetadataFilePort = (
  artwork: ArtworkService,
  artworkPaths: ProductionArtworkPaths
): MetadataFilePort => {
  const sourceFor = (value: string) => {
    const localPath = artworkPaths.localPath(value.split(/[?#]/u)[0]);
    if (localPath) return pathArtwork(localPath);
    return /^(?:https?|nora|asset):/iu.test(value) ? urlArtwork(value) : pathArtwork(value);
  };

  /**
   * The route for everything that is not an MP3.
   *
   * node-id3 below writes ID3, which exists in MP3 and not in FLAC, so this is
   * what makes a FLAC editable at all once a cover or lyrics are involved.
   * TagLib writes whatever tag the container really has, and goes through the
   * same validated, atomic commit as the blank-MIME repair does.
   */
  const writeTagsWithTagLib = async (path: string, patch: MetadataTagPatch): Promise<void> => {
    const replacementArtwork = patch.artwork?.kind === 'replace' ? patch.artwork : undefined;
    const picture = replacementArtwork
      ? createTagLibPicture(
          new Uint8Array(
            await (await artwork.convertToPng(sourceFor(replacementArtwork.path))).arrayBuffer()
          ),
          'image/png'
        )
      : undefined;

    const tagPatch: TagLibPatch = {};
    if (Object.hasOwn(patch, 'title')) tagPatch.title = patch.title;
    if (Object.hasOwn(patch, 'artists')) tagPatch.artists = patch.artists;
    if (Object.hasOwn(patch, 'albumArtists')) tagPatch.albumArtists = patch.albumArtists;
    if (Object.hasOwn(patch, 'album')) tagPatch.album = patch.album;
    if (Object.hasOwn(patch, 'genres')) tagPatch.genres = patch.genres;
    if (Object.hasOwn(patch, 'composer')) tagPatch.composer = patch.composer;
    if (Object.hasOwn(patch, 'trackNumber')) tagPatch.trackNumber = patch.trackNumber;
    if (Object.hasOwn(patch, 'year')) tagPatch.year = patch.year;
    // One lyrics field in a Vorbis comment, and the synchronised form is LRC
    // text, so it goes in as written rather than being flattened.
    if (Object.hasOwn(patch, 'synchronizedLyrics')) tagPatch.lyrics = patch.synchronizedLyrics;
    else if (Object.hasOwn(patch, 'unsynchronizedLyrics')) {
      tagPatch.lyrics = patch.unsynchronizedLyrics;
    }
    if (replacementArtwork) tagPatch.picture = picture;
    else if (patch.artwork?.kind === 'remove') tagPatch.picture = null;

    await updateTagLibFile(path, (file) => applyTagLibPatch(file as never, tagPatch));
  };

  const writeTags = async (path: string, patch: MetadataTagPatch): Promise<void> => {
    // MP3 keeps the route it has always used. Everything else could not use it
    // at all, which is the whole reason the editor was limited to MP3.
    if (!/\.mp3$/iu.test(path.split(/[?#]/u)[0])) return writeTagsWithTagLib(path, patch);

    const hasSynchronizedLyrics = Object.hasOwn(patch, 'synchronizedLyrics');
    const replacementArtwork = patch.artwork?.kind === 'replace' ? patch.artwork : undefined;
    const previous = hasSynchronizedLyrics ? await readNodeId3Tags(path) : undefined;
    const nodePatch: Parameters<typeof updateNodeId3Tags>[1] = {};
    if (Object.hasOwn(patch, 'title')) nodePatch.title = patch.title;
    if (Object.hasOwn(patch, 'artists')) nodePatch.artist = patch.artists?.join(', ');
    if (Object.hasOwn(patch, 'albumArtists')) {
      nodePatch.performerInfo = patch.albumArtists?.join(', ');
    }
    if (Object.hasOwn(patch, 'album')) nodePatch.album = patch.album;
    if (Object.hasOwn(patch, 'genres')) nodePatch.genre = patch.genres?.join(', ');
    if (Object.hasOwn(patch, 'composer')) nodePatch.composer = patch.composer;
    if (Object.hasOwn(patch, 'trackNumber')) {
      nodePatch.trackNumber = patch.trackNumber?.toString();
    }
    if (Object.hasOwn(patch, 'year')) nodePatch.year = patch.year?.toString();
    if (hasSynchronizedLyrics) {
      const parsed = patch.synchronizedLyrics ? parseLyrics(patch.synchronizedLyrics) : undefined;
      nodePatch.synchronisedLyrics = convertParsedLyricsToNodeID3Format(
        parsed,
        previous?.synchronisedLyrics
      );
    }
    if (Object.hasOwn(patch, 'unsynchronizedLyrics')) {
      nodePatch.unsynchronisedLyrics = patch.unsynchronizedLyrics
        ? { language: 'ENG', text: parseLyrics(patch.unsynchronizedLyrics).unparsedLyrics }
        : undefined;
    }
    if (replacementArtwork) {
      const png = await artwork.convertToPng(sourceFor(replacementArtwork.path));
      nodePatch.image = {
        type: { id: 1 },
        mime: 'image/png',
        description: 'artwork',
        imageBuffer: Buffer.from(await png.arrayBuffer()) as unknown as import('buffer').Buffer
      };
    } else if (patch.artwork?.kind === 'remove') {
      nodePatch.image = undefined;
    }
    await updateNodeId3Tags(path, nodePatch);
  };

  return {
    read: async (path) => {
      const [metadata, stats] = await Promise.all([
        readTagLibFile(path, (file) => {
          const picture = file.tag.pictures.at(0);
          return {
            title: file.tag.title || undefined,
            artists: [...file.tag.performers],
            albumArtists: [...file.tag.albumArtists],
            album: file.tag.album || undefined,
            genres: [...file.tag.genres],
            year: file.tag.year || undefined,
            trackNumber: file.tag.track || undefined,
            discNumber: file.tag.disc || undefined,
            duration: file.properties.durationMilliseconds / 1000,
            bitrate: file.properties.audioBitrate ? file.properties.audioBitrate * 1000 : undefined,
            sampleRate: file.properties.audioSampleRate || undefined,
            numberOfChannels: file.properties.audioChannels || undefined,
            picture: picture
              ? {
                  bytes: picture.data.toByteArray(),
                  mimeType: picture.mimeType || 'image/jpeg'
                }
              : undefined
          };
        }),
        tauriLibraryFileSystem.stat(path)
      ]);
      return {
        ...metadata,
        createdDate: stats.birthtime?.getTime(),
        modifiedDate: stats.mtime?.getTime()
      };
    },
    write: writeTags,
    healBlankPictureMime: async (path) => (await healBlankFlacPictureMime(path)).healedPictureCount
  };
};

const createProductionServices = (
  artworkPaths: ProductionArtworkPaths,
  forceTypeScript: boolean,
  /**
   * The same logger the other core modules write through, so an artwork failure
   * lands in Nemora.log with its reason attached. Wiring it here was worth a
   * separate mention: a blocked cover host used to surface as "Failed to create
   * artwork variants [object Object]" and nothing else, which says that
   * something went wrong and refuses to say what.
   */
  coreLogger: ArtworkLogger
): RuntimeServices => {
  installTagSuppressionHook();
  const artworkStorage = new TauriArtworkStorage(
    { album: albumCover, playlist: playlistCover, song: songCover },
    undefined
  );
  // Native artwork first, browser route as the fallback. `createArtworkPipeline`
  // returns undefined when the environment asks for TypeScript, and the service
  // then behaves exactly as it did before this existed.
  const artworkPipeline = createArtworkPipeline(productionLogger, forceTypeScript);
  const artwork = new ArtworkService(
    artworkStorage,
    new ImageTransformer(new BrowserImageBackend()),
    coreLogger,
    undefined,
    artworkPipeline,
    // Only reached when a native scan named a cover and the native artwork
    // route then declined it - the same binary supplies both, so the pairing
    // holds by construction.
    {
      read: async (path) => {
        const tags = await invoke<{ pictureBytes?: number[]; pictureMimeType?: string }>(
          'tags_read',
          { path, includePicture: true }
        );
        if (!tags.pictureBytes?.length) return undefined;
        return {
          bytes: new Uint8Array(tags.pictureBytes),
          mimeType: tags.pictureMimeType ?? ''
        };
      }
    }
  );
  return {
    artwork,
    palette: new PaletteGenerator(
      undefined,
      productionLogger,
      undefined,
      undefined,
      artworkPipeline ? (path) => artworkPipeline.palette(path) : undefined
    ),
    files: productionFiles,
    decrypt: (encrypted) => decryptCredential(encrypted),
    readEmbeddedLyrics: (path) => readNodeId3Tags(path),
    readSongTags: (path) => readNodeId3Tags(path, { noRaw: true }),
    writeEmbeddedLyrics: (path, tags) => updateNodeId3Tags(path, tags),
    restartApp: () => void relaunch(),
    createNoraImportPort: createDefaultNoraImportPort,
    discordClientId: getBuildEnvVariable('MAIN_VITE_DISCORD_CLIENT_ID'),
    setDiscordActivity: async (clientId, activity) => {
      await invoke('discord_connect', { clientId });
      await invoke('discord_set_activity', { activity });
    },
    disconnectDiscord: () => invoke('discord_disconnect'),
    libraryFileSystem: tauriLibraryFileSystem,
    watcherFileSystem: tauriWatcherFileSystem,
    metadataParser: createMetadataParser(),
    nativeLibrary: createNativeLibrary(forceTypeScript),
    // Native tags first, TagLib behind it. The TypeScript port stays the
    // complete implementation - it is what a non-Tauri host runs, and it is
    // still what writes artwork and lyrics.
    metadata: forceTypeScript
      ? createMetadataFilePort(artwork, artworkPaths)
      : new TauriMetadataFilePort(
          createMetadataFilePort(artwork, artworkPaths),
          async (path) => {
            const stats = await tauriLibraryFileSystem.stat(path);
            return {
              createdDate: stats.birthtime?.getTime(),
              modifiedDate: stats.mtime?.getTime()
            };
          },
          productionLogger
        ),
    romanizeForSearch,
    permanentlyDeleteFile: (path) => remove(path),
    moveFileToTrash: (path) => invoke<void>('trash_item', { path }),
    removeDuelQueueReferences: (songIds) => {
      const serialized = globalThis.localStorage?.getItem('localStorage');
      if (!serialized) return;
      try {
        const stored = JSON.parse(serialized) as LocalStorage;
        if (!stored.duels) return;
        const updated = {
          ...stored,
          duels: removeSongReferencesFromDuels(stored.duels, new Set(songIds))
        };
        globalThis.localStorage.setItem('localStorage', JSON.stringify(updated));
      } catch (error) {
        productionLogger.error('Failed to remove deleted songs from the local duel queue.', {
          error,
          songIds
        });
      }
    },
    singleInstance: createSingleInstanceService(),
    system: {
      revealSong: (path) => invoke<void>('reveal_song_in_file_explorer', { path }),
      revealFolder: (path) => invoke<void>('reveal_folder_in_file_explorer', { path }),
      openLogFile: () => invoke<void>('open_log_file'),
      directorySize: (path) => invoke<number>('directory_size', { path }),
      diskCapacity: async (path) => {
        const capacity = await invoke<{ total_bytes: number; free_bytes: number }>(
          'disk_capacity',
          { path }
        );
        return { totalBytes: capacity.total_bytes, freeBytes: capacity.free_bytes };
      },
      pathsShareVolume: (first, second) => invoke<boolean>('paths_share_volume', { first, second }),
      applicationDirectory: executableDir,
      toggleAutoLaunch: (enabled) => invoke<void>('toggle_auto_launch', { enabled }),
      openDevTools: () => invoke<void>('open_devtools'),
      setDisplaySleepInhibited: (inhibited) =>
        invoke<void>(inhibited ? 'stop_screen_sleeping' : 'allow_screen_sleeping')
    },
    selectMusicFolders: async () => {
      const selected = await openDialog({ directory: true, multiple: true });
      if (typeof selected === 'string') return [selected];
      return selected ?? [];
    }
  };
};

export async function createProductionRuntimeOptions(): Promise<NoraRuntimeOptions> {
  const coreLogger = wireCoreLoggers();
  const artwork = new ProductionArtworkPaths(await songCoversDir());
  // Resolved once, here, rather than consulted per call: a switch that answers
  // differently halfway through a scan would be worse than either route.
  const forceTypeScript = await invoke<boolean>('force_typescript').catch(() => false);
  return {
    version: await getVersion(),
    artwork,
    events: new LocalRuntimeEventSink(),
    services: createProductionServices(artwork, forceTypeScript, coreLogger)
  };
}
