export type PathBackedAudioPlayerData = Omit<AudioPlayerData, 'artwork'> & {
  artwork?: string;
};

export type PathBackedUpdateSongDataResult = Omit<UpdateSongDataResult, 'updatedData'> & {
  updatedData?: PathBackedAudioPlayerData;
};
