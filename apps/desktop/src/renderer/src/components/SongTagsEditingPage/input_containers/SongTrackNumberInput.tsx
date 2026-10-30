import { useTranslation } from 'react-i18next';

type Props = {
  songTrackNumber?: number;
  updateSongInfo: (_callback: (_prevSongInfo: SongTags) => SongTags) => void;
};

const SongTrackNumberInput = (props: Props) => {
  const { t } = useTranslation();

  const { songTrackNumber, updateSongInfo } = props;
  return (
    <div className="tag-input flex min-w-[10rem] max-w-2xl flex-col">
      <label htmlFor="song-track-number-id3-tag">{t('common.albumTrackNo')}</label>
      <input
        type="number"
        id="song-track-number-id3-tag"
        className="mr-2 mt-2 w-[90%] rounded-3xl border-[.15rem] border-surface-2 bg-surface-2 px-4 py-3 text-ink transition-colors focus:border-echo "
        name="song-track-number"
        placeholder={t('common.albumTrackNo')}
        value={songTrackNumber ?? ''}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const trackNumber = e.currentTarget.valueAsNumber;
          updateSongInfo((prevData) => ({ ...prevData, trackNumber }));
        }}
      />
    </div>
  );
};

export default SongTrackNumberInput;
