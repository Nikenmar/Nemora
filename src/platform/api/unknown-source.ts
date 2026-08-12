import { getRuntime } from '../runtime';
import type { PathBackedAudioPlayerData } from './binary';
import { scalarPayload, subscribe, unsubscribe } from './events';

type UnknownSourceCallback = (event: unknown, audioPlayerData: PathBackedAudioPlayerData) => void;

export const unknownSource = {
  playSongFromUnknownSource: (callback: UnknownSourceCallback): void =>
    subscribe('app/playSongFromUnknownSource', callback, scalarPayload<PathBackedAudioPlayerData>),
  getSongFromUnknownSource: (songPath: string): Promise<PathBackedAudioPlayerData> =>
    getRuntime().getSongFromUnknownSource(songPath),
  removePlaySongFromUnknownSourceEvent: (callback: UnknownSourceCallback): void =>
    unsubscribe('app/playSongFromUnknownSource', callback)
};
