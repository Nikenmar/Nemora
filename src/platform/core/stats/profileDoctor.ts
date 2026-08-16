import { trackKeyOf, type ListeningCounterFile } from './listeningEvents';
import { fingerprintOfSong } from './songFingerprint';

export interface ProfileListeningRowIssue {
  rowIndex: number;
  songId: string;
}

export interface DuplicateListeningRowsIssue {
  songId: string;
  rowIndexes: number[];
}

export interface TrackKeyCollisionIssue {
  trackKey: string;
  songIds: string[];
}

export interface MissingLibraryFileIssue {
  songId: string;
  path: string;
}

export interface UnmatchedCounterTrackIssue {
  trackKey: string;
  sourceIds: string[];
  fingerprint?: SongFingerprint;
}

export interface ProfileReport {
  recoverableOrphanedListeningRows: ProfileListeningRowIssue[];
  unidentifiableOrphanedListeningRows: ProfileListeningRowIssue[];
  duplicateListeningRows: DuplicateListeningRowsIssue[];
  trackKeyCollisions: TrackKeyCollisionIssue[];
  missingLibraryFiles: MissingLibraryFileIssue[];
  unmatchedCounterTracks: UnmatchedCounterTrackIssue[];
}

export interface ProfileInspectionInput {
  songs: readonly SavableSongData[];
  listeningData: readonly SongListeningData[];
  listeningCounters: ListeningCounterFile;
  exists(path: string): boolean;
}

/** Inspects a complete profile without mutating it or accessing the filesystem directly. */
export const inspectProfile = (input: ProfileInspectionInput): ProfileReport => {
  const libraryIds = new Set(input.songs.map((song) => song.songId));
  const recoverableOrphanedListeningRows: ProfileListeningRowIssue[] = [];
  const unidentifiableOrphanedListeningRows: ProfileListeningRowIssue[] = [];
  const rowIndexesBySongId = new Map<string, number[]>();

  input.listeningData.forEach((row, rowIndex) => {
    const indexes = rowIndexesBySongId.get(row.songId);
    if (indexes) indexes.push(rowIndex);
    else rowIndexesBySongId.set(row.songId, [rowIndex]);

    if (libraryIds.has(row.songId)) return;
    const issue = { rowIndex, songId: row.songId };
    if (row.fingerprint) recoverableOrphanedListeningRows.push(issue);
    else unidentifiableOrphanedListeningRows.push(issue);
  });

  const duplicateListeningRows = [...rowIndexesBySongId]
    .filter(([, rowIndexes]) => rowIndexes.length > 1)
    .map(([songId, rowIndexes]) => ({ songId, rowIndexes: [...rowIndexes] }));

  const songsByTrackKey = new Map<string, string[]>();
  for (const song of input.songs) {
    const trackKey = trackKeyOf(fingerprintOfSong(song));
    const songIds = songsByTrackKey.get(trackKey);
    if (songIds) songIds.push(song.songId);
    else songsByTrackKey.set(trackKey, [song.songId]);
  }
  const trackKeyCollisions = [...songsByTrackKey]
    .filter(([, songIds]) => songIds.length > 1)
    .map(([trackKey, songIds]) => ({ trackKey, songIds: [...songIds] }));

  const missingLibraryFiles = input.songs
    .filter((song) => !input.exists(song.path))
    .map((song) => ({ songId: song.songId, path: song.path }));

  const unmatchedCounterTracks = Object.entries(input.listeningCounters.counters)
    .filter(([trackKey]) => !songsByTrackKey.has(trackKey))
    .map(([trackKey, sources]) => ({
      trackKey,
      sourceIds: Object.keys(sources).sort(),
      ...(input.listeningCounters.tracks[trackKey]
        ? { fingerprint: input.listeningCounters.tracks[trackKey] }
        : {})
    }));

  return {
    recoverableOrphanedListeningRows,
    unidentifiableOrphanedListeningRows,
    duplicateListeningRows,
    trackKeyCollisions,
    missingLibraryFiles,
    unmatchedCounterTracks
  };
};
