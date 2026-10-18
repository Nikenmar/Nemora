import { getRuntime } from '../runtime';

export const folderData = {
  getFolderData: async (
    folderPaths: string[],
    sortType?: FolderSortTypes
  ): Promise<MusicFolder[]> => getRuntime().getFolders(folderPaths, sortType),
  blacklistFolders: async (folderPaths: string[]): Promise<void> =>
    getRuntime().blacklistFolders(folderPaths),
  restoreBlacklistedFolders: async (folderPaths: string[]): Promise<void> =>
    getRuntime().restoreBlacklistedFolders(folderPaths),
  toggleBlacklistedFolders: async (
    folderPaths: string[],
    isBlacklistFolder?: boolean
  ): Promise<void> =>
    getRuntime().toggleBlacklistedFolders(
      folderPaths,
      isBlacklistFolder
    ) as unknown as Promise<void>,
  revealFolderInFileExplorer: (folderPath: string): void => {
    void getRuntime()
      .revealFolderInFileExplorer(folderPath)
      .catch((error: unknown) => console.error('Failed to reveal folder in Explorer.', error));
  },
  getFolderStructures: (): Promise<FolderStructure[]> => getRuntime().getFolderStructures(),
  removeAMusicFolder: (absolutePath: string): Promise<void> =>
    getRuntime().removeMusicFolder(absolutePath)
};
