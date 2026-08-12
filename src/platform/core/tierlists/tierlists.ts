/**
 * Tierlist CRUD (fork identity: classic tiermaker S A B C D E F default rows).
 *
 * Port of `src/main/core/tierlists.ts`. Tierlist data, id generation and the
 * local data-update bus arrive through the injected `TierlistsRepo` — no store
 * is imported directly. Signatures match the preload wrappers; callers curry
 * the repo: `addTierlist(repo, name, sourcePlaylistIds, labelMode, folders)`.
 */

export interface TierlistsRepo {
  getTierlistData(tierlistIds?: string[]): SavableTierlist[];
  setTierlistData(tierlists: SavableTierlist[]): void;
  generateRandomId(): string;
  /** Local data-update bus; expected to keep the one-second coalescing behavior. */
  emitDataUpdate(dataType: DataUpdateEventTypes, data?: string[], message?: string): void;
  logger: {
    warn(message: string, data?: object): void;
    info(message: string, data?: object): void;
    error(message: string, data?: object): void;
  };
}

/** Default tier rows for a fresh tierlist — classic tiermaker S A B C D E F. */
const DEFAULT_TIER_LABELS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

const createDefaultTiers = (repo: TierlistsRepo): TierRow[] =>
  DEFAULT_TIER_LABELS.map((name) => ({ tierId: repo.generateRandomId(), name, items: [] }));

const sortTierlists = (tierlists: SavableTierlist[], sortType?: TierlistSortTypes) => {
  if (!sortType) return tierlists;
  const sorted = [...tierlists];
  switch (sortType) {
    case 'aToZ':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'zToA':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'dateAddedAscending':
      return sorted.sort(
        (a, b) => new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime()
      );
    case 'dateAddedDescending':
      return sorted.sort(
        (a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
      );
    default:
      return sorted;
  }
};

export const sendTierlistData = (
  repo: TierlistsRepo,
  tierlistIds = [] as string[],
  sortType?: TierlistSortTypes
): SavableTierlist[] => {
  const tierlists = repo.getTierlistData(tierlistIds);
  return sortTierlists(tierlists, sortType);
};

export const addTierlist = (
  repo: TierlistsRepo,
  name: string,
  sourcePlaylistIds: string[] = [],
  labelMode: TierlistLabelMode = 'track',
  sourceFolderPaths: string[] = []
): { success: boolean; message?: string; tierlist?: SavableTierlist } => {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, message: 'Tierlist name cannot be empty.' };

    const tierlists = repo.getTierlistData();
    if (tierlists.some((tierlist) => tierlist.name === trimmedName)) {
      repo.logger.warn(`A tierlist named '${trimmedName}' already exists.`);
      return { success: false, message: `A tierlist named '${trimmedName}' already exists.` };
    }

    const newTierlist: SavableTierlist = {
      tierlistId: repo.generateRandomId(),
      name: trimmedName,
      createdDate: new Date(),
      sourcePlaylistIds: Array.isArray(sourcePlaylistIds) ? sourcePlaylistIds : [],
      sourceFolderPaths: Array.isArray(sourceFolderPaths) ? sourceFolderPaths : [],
      tiers: createDefaultTiers(repo),
      labelMode
    };

    tierlists.push(newTierlist);
    repo.setTierlistData(tierlists);
    repo.emitDataUpdate('tierlists/newTierlist', [newTierlist.tierlistId]);
    repo.logger.info(`Created a new tierlist '${trimmedName}'.`);

    return { success: true, tierlist: newTierlist };
  } catch (error) {
    repo.logger.error('Failed to create a new tierlist.', { error });
    return { success: false, message: 'Failed to create a new tierlist.' };
  }
};

export const saveTierlist = (
  repo: TierlistsRepo,
  updatedTierlist: SavableTierlist
): { success: boolean; message?: string } => {
  try {
    if (!updatedTierlist?.tierlistId) return { success: false, message: 'Invalid tierlist.' };

    const tierlists = repo.getTierlistData();
    const index = tierlists.findIndex((t) => t.tierlistId === updatedTierlist.tierlistId);
    if (index === -1) {
      repo.logger.warn(`Cannot save tierlist '${updatedTierlist.tierlistId}' — not found.`);
      return { success: false, message: 'Tierlist not found.' };
    }

    tierlists[index] = { ...tierlists[index], ...updatedTierlist };
    repo.setTierlistData(tierlists);
    repo.emitDataUpdate('tierlists/updatedTierlist', [updatedTierlist.tierlistId]);
    return { success: true };
  } catch (error) {
    repo.logger.error('Failed to save tierlist.', { error });
    return { success: false, message: 'Failed to save tierlist.' };
  }
};

export const removeTierlists = (
  repo: TierlistsRepo,
  tierlistIds: string[]
): { success: boolean; message?: string } => {
  try {
    if (!Array.isArray(tierlistIds) || tierlistIds.length === 0)
      return { success: false, message: 'No tierlists specified.' };

    const tierlists = repo.getTierlistData();
    const remaining = tierlists.filter((t) => !tierlistIds.includes(t.tierlistId));
    repo.setTierlistData(remaining);
    repo.emitDataUpdate('tierlists/deletedTierlist', tierlistIds);
    repo.logger.info(`Removed ${tierlistIds.length} tierlist(s).`);
    return { success: true };
  } catch (error) {
    repo.logger.error('Failed to remove tierlists.', { error });
    return { success: false, message: 'Failed to remove tierlists.' };
  }
};
