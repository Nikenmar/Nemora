/**
 * The two library walks must produce the SAME folder tree.
 *
 * Since the host walk arrived, a folder structure can be built two ways: from
 * `readDir` one directory at a time, or from the flat list Rust returns in one
 * call. They are different code, they run on different hosts, and only one of
 * them is exercised by the app you are looking at - which is exactly the shape
 * of a defect nobody notices until song counts are wrong on a real library.
 *
 * So the test feeds both routes the same tree and demands identical output. Set
 * `NEMORA_WALK_ROOT` to use a real music folder instead of the synthetic tree,
 * which is the version worth running before trusting a release:
 *
 * ```text
 * NEMORA_WALK_ROOT="E:\Music" npx jest walkParity
 * ```
 */
import nodeFs from 'node:fs';
import nodePath from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { SUPPORTED_MUSIC_EXTENSIONS } from '../constants';
import { walkMusicTrees } from '../traversal';
import type {
  DirectoryEntry,
  LibraryFileSystemPort,
  NativeLibraryPort,
  WalkedDirectory
} from '../types';

interface Tree {
  [name: string]: Tree | null;
}

const SYNTHETIC: Tree = {
  'root.flac': null,
  'notes.txt': null,
  Rock: {
    'second.MP3': null,
    'cover.jpg': null,
    Deep: { 'third.ogg': null, 'fourth.opus': null },
    Empty: {}
  },
  Jazz: { 'one.m4a': null }
};

const supported = new Set(SUPPORTED_MUSIC_EXTENSIONS.map((value) => value.toLowerCase()));
const isMusic = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && supported.has(name.slice(dot).toLowerCase());
};

/** Reads a real directory into the same shape, so both routes see one truth. */
const readRealTree = (root: string): Tree => {
  const tree: Tree = {};
  for (const entry of nodeFs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) tree[entry.name] = readRealTree(nodePath.join(root, entry.name));
    else if (entry.isFile()) tree[entry.name] = null;
  }
  return tree;
};

const resolve = (tree: Tree, root: string, path: string): Tree | undefined => {
  if (path === root) return tree;
  if (!path.startsWith(`${root}\\`)) return undefined;
  let node: Tree | undefined = tree;
  for (const part of path.slice(root.length + 1).split('\\')) {
    const child: Tree | null | undefined = node?.[part];
    if (child === null || child === undefined) return undefined;
    node = child;
  }
  return node;
};

const stats = {
  isFile: false,
  isDirectory: true,
  size: 0,
  mtime: new Date('2026-01-02T03:04:05Z'),
  birthtime: new Date('2020-01-01T00:00:00Z')
};

const fileSystemFor = (tree: Tree, root: string): LibraryFileSystemPort => ({
  readDir: async (path) => {
    const node = resolve(tree, root, path);
    if (!node) throw new Error(`no such directory: ${path}`);
    return Object.entries(node).map(
      ([name, child]): DirectoryEntry => ({
        name,
        isDirectory: child !== null,
        isFile: child === null,
        isSymlink: false
      })
    );
  },
  stat: async (path) => ({ ...stats, isDirectory: resolve(tree, root, path) !== undefined }),
  readHead: async () => new Uint8Array()
});

/** The flat answer the Rust walk gives for the same tree. */
const nativeFor = (tree: Tree, root: string): NativeLibraryPort => {
  const walked: WalkedDirectory[] = [];
  const visit = (node: Tree, path: string): void => {
    const directories: string[] = [];
    const files: string[] = [];
    for (const [name, child] of Object.entries(node)) {
      const childPath = `${path}\\${name}`;
      if (child !== null) directories.push(childPath);
      else if (isMusic(name)) files.push(childPath);
    }
    directories.sort();
    files.sort();
    walked.push({
      path,
      modified: stats.mtime.getTime(),
      created: stats.birthtime.getTime(),
      directories,
      files
    });
    for (const [name, child] of Object.entries(node)) {
      if (child !== null) visit(child, `${path}\\${name}`);
    }
  };
  visit(tree, root);
  return { walk: async () => walked, parse: async () => undefined };
};

/** Counts and paths only: the two routes may order siblings differently. */
const shapeOf = (structure: FolderStructure): unknown => ({
  path: structure.path,
  noOfSongs: structure.noOfSongs,
  subFolders: [...structure.subFolders]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((child) => shapeOf(child))
});

const realRoot = process.env.NEMORA_WALK_ROOT;

describe('the two library walks agree', () => {
  const cases: [string, Tree, string][] = [['a synthetic tree', SYNTHETIC, 'C:\\Music']];
  if (realRoot && nodeFs.existsSync(realRoot)) {
    cases.push([`the real folder ${realRoot}`, readRealTree(realRoot), realRoot.replace(/\\$/u, '')]);
  }

  test.each(cases)('%s produces one folder tree, whichever route builds it', async (_, tree, root) => {
    const fileSystem = fileSystemFor(tree, root);

    const viaReadDir = await walkMusicTrees(fileSystem, [root]);
    const viaHost = await walkMusicTrees(fileSystem, [root], { native: nativeFor(tree, root) });

    expect(viaHost.songPaths.length).toBe(viaReadDir.songPaths.length);
    expect([...viaHost.songPaths].sort()).toEqual([...viaReadDir.songPaths].sort());
    expect([...viaHost.visitedDirectories].sort()).toEqual(
      [...viaReadDir.visitedDirectories].sort()
    );
    expect(viaHost.structures.map(shapeOf)).toEqual(viaReadDir.structures.map(shapeOf));
    // The number every Folders row shows, at the root.
    expect(viaHost.structures[0]?.noOfSongs).toBe(viaReadDir.structures[0]?.noOfSongs);
  });

  test('overlapping roots are de-duplicated the same way by both routes', async () => {
    const root = 'C:\\Music';
    const fileSystem = fileSystemFor(SYNTHETIC, root);
    const roots = [root, `${root}\\Rock`];

    const viaReadDir = await walkMusicTrees(fileSystem, roots);
    const viaHost = await walkMusicTrees(fileSystem, roots, { native: nativeFor(SYNTHETIC, root) });

    expect(viaHost.visitedDirectories.length).toBe(viaReadDir.visitedDirectories.length);
    expect([...viaHost.songPaths].sort()).toEqual([...viaReadDir.songPaths].sort());
  });
});
