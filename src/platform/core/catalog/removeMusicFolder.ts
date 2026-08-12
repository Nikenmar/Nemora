import { canonicalPathKey } from '../library/path';
import { fileNameOf, isPathWithin } from './path';
import { removeSongsFromLibrary } from './removeSongs';
import type { CatalogRepository } from './repository';

const removeFolder = (
  folders: readonly FolderStructure[],
  targetKey: string
): { folders: FolderStructure[]; found: boolean } => {
  let found = false;
  const output: FolderStructure[] = [];
  for (const folder of folders) {
    if (canonicalPathKey(folder.path) === targetKey) {
      found = true;
      continue;
    }
    const nested = removeFolder(folder.subFolders, targetKey);
    if (nested.found) found = true;
    output.push({ ...folder, subFolders: nested.folders });
  }
  return { folders: output, found };
};

export const removeMusicFolder = async (
  repository: CatalogRepository,
  folderPath: string
): Promise<boolean> => {
  const current = repository.getCatalogState();
  const targetKey = canonicalPathKey(folderPath);
  const updatedFolders = removeFolder(current.userData.musicFolders, targetKey);
  if (!updatedFolders.found) return false;

  const relatedSongPaths = current.songs
    .filter((song) => isPathWithin(song.path, folderPath))
    .map((song) => song.path);
  await removeSongsFromLibrary(repository, relatedSongPaths);

  const next = repository.getCatalogState();
  next.userData = { ...next.userData, musicFolders: updatedFolders.folders };
  next.blacklist = {
    ...next.blacklist,
    folderBlacklist: next.blacklist.folderBlacklist.filter(
      (blacklistedPath) => !isPathWithin(blacklistedPath, folderPath)
    )
  };
  next.tierlists = next.tierlists.map((tierlist) => ({
    ...tierlist,
    sourceFolderPaths: tierlist.sourceFolderPaths?.filter(
      (sourcePath) => !isPathWithin(sourcePath, folderPath)
    )
  }));
  repository.commitCatalogState(next);
  repository.emitDataUpdate('userData/musicFolder');
  repository.emitDataUpdate('blacklist/folderBlacklist');
  repository.emitDataUpdate('tierlists');
  repository.sendMessage(
    relatedSongPaths.length > 0 ? 'MUSIC_FOLDER_DELETED' : 'EMPTY_MUSIC_FOLDER_DELETED',
    { name: fileNameOf(folderPath), count: relatedSongPaths.length }
  );
  return true;
};

