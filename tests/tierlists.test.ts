import {
  addTierlist,
  removeTierlists,
  saveTierlist,
  sendTierlistData
} from '../src/platform/core/tierlists/tierlists';
import type { TierlistsRepo } from '../src/platform/core/tierlists/tierlists';

const tierlist = (tierlistId: string, name: string, createdDate = new Date(2026, 0, 1)): SavableTierlist => ({
  tierlistId,
  name,
  createdDate,
  sourcePlaylistIds: [],
  labelMode: 'track',
  tiers: []
});

const createRepo = (overrides: Partial<TierlistsRepo> = {}) => {
  let tierlists: SavableTierlist[] = [];
  let idCounter = 0;
  const events: [DataUpdateEventTypes, string[]?][] = [];
  const repo: TierlistsRepo = {
    getTierlistData: (ids?: string[]) =>
      ids?.length ? tierlists.filter((t) => ids.includes(t.tierlistId)) : tierlists,
    setTierlistData: (data) => {
      tierlists = data;
    },
    generateRandomId: () => `id-${++idCounter}`,
    emitDataUpdate: (type, data) => events.push([type, data]),
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
    ...overrides
  };
  return {
    repo,
    events,
    seed: (seed: SavableTierlist[]) => {
      tierlists = seed;
    },
    current: () => tierlists
  };
};

describe('ported tierlists CRUD', () => {
  test('addTierlist creates a tierlist with default S..F tiers and persists it', () => {
    const { repo, events, current } = createRepo();
    const result = addTierlist(repo, '  My List  ', ['p1']);

    expect(result.success).toBe(true);
    expect(result.tierlist?.name).toBe('My List');
    expect(result.tierlist?.tierlistId).toBe('id-1');
    expect(result.tierlist?.tiers.map((t) => t.name)).toEqual(['S', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(result.tierlist?.tiers.every((t) => t.items.length === 0)).toBe(true);
    expect(result.tierlist?.sourcePlaylistIds).toEqual(['p1']);
    expect(result.tierlist?.labelMode).toBe('track');
    expect(current()).toHaveLength(1);
    expect(events).toEqual([['tierlists/newTierlist', ['id-1']]]);
  });

  test('addTierlist rejects an empty name and duplicate names', () => {
    const { repo, seed } = createRepo();
    expect(addTierlist(repo, '   ').success).toBe(false);
    seed([tierlist('existing', 'Taken')]);
    const duplicate = addTierlist(repo, 'Taken');
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toContain('already exists');
  });

  test('addTierlist defaults non-array sources to empty arrays', () => {
    const { repo } = createRepo();
    // @ts-expect-error deliberately passing non-array values at runtime
    const result = addTierlist(repo, 'List', 'not-an-array', 'track', 'also-not-an-array');
    expect(result.tierlist?.sourcePlaylistIds).toEqual([]);
    expect(result.tierlist?.sourceFolderPaths).toEqual([]);
  });

  test('saveTierlist merges into the existing record and emits an update', () => {
    const { repo, seed, events, current } = createRepo();
    seed([tierlist('t1', 'Old Name')]);
    const result = saveTierlist(repo, { ...tierlist('t1', 'New Name'), influencesShuffle: true });

    expect(result.success).toBe(true);
    expect(current()[0].name).toBe('New Name');
    expect(current()[0].influencesShuffle).toBe(true);
    expect(events).toEqual([['tierlists/updatedTierlist', ['t1']]]);
  });

  test('saveTierlist rejects missing and invalid tierlists', () => {
    const { repo } = createRepo();
    expect(saveTierlist(repo, tierlist('missing', 'X')).message).toBe('Tierlist not found.');
    expect(saveTierlist(repo, { ...tierlist('', 'X') }).message).toBe('Invalid tierlist.');
  });

  test('removeTierlists removes matching ids and emits deletion', () => {
    const { repo, seed, events, current } = createRepo();
    seed([tierlist('t1', 'A'), tierlist('t2', 'B')]);
    const result = removeTierlists(repo, ['t1', 't2']);

    expect(result.success).toBe(true);
    expect(current()).toEqual([]);
    expect(events).toEqual([['tierlists/deletedTierlist', ['t1', 't2']]]);
  });

  test('removeTierlists rejects an empty selection', () => {
    const { repo } = createRepo();
    expect(removeTierlists(repo, []).message).toBe('No tierlists specified.');
  });
});

describe('ported sendTierlistData sorting', () => {
  const seed: SavableTierlist[] = [
    tierlist('older', 'Beta', new Date(2026, 0, 1)),
    tierlist('newer', 'Alpha', new Date(2026, 5, 1))
  ];

  test('returns the stored order without a sort type', () => {
    const { repo, seed: seedData } = createRepo();
    seedData(seed);
    expect(sendTierlistData(repo).map((t) => t.tierlistId)).toEqual(['older', 'newer']);
  });

  test('sorts alphabetically in both directions', () => {
    const { repo, seed: seedData } = createRepo();
    seedData(seed);
    expect(sendTierlistData(repo, [], 'aToZ').map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    expect(sendTierlistData(repo, [], 'zToA').map((t) => t.name)).toEqual(['Beta', 'Alpha']);
  });

  test('sorts by created date in both directions', () => {
    const { repo, seed: seedData } = createRepo();
    seedData(seed);
    expect(sendTierlistData(repo, [], 'dateAddedAscending').map((t) => t.tierlistId)).toEqual([
      'older',
      'newer'
    ]);
    expect(sendTierlistData(repo, [], 'dateAddedDescending').map((t) => t.tierlistId)).toEqual([
      'newer',
      'older'
    ]);
  });

  test('filters by ids before sorting', () => {
    const { repo, seed: seedData } = createRepo();
    seedData(seed);
    expect(sendTierlistData(repo, ['newer'], 'aToZ').map((t) => t.tierlistId)).toEqual(['newer']);
  });
});
