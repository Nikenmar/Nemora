import { useTranslation } from 'react-i18next';

type Props = {
  songYear?: number;
  updateSongInfo: (_callback: (_prevSongInfo: SongTags) => SongTags) => void;
};

const SongYearInput = (props: Props) => {
  const { t } = useTranslation();

  const { songYear, updateSongInfo } = props;

  return (
    <div className="tag-input flex min-w-[10rem] max-w-2xl flex-col">
      <label htmlFor="song-year-id3-tag">{t('common.releasedYear')}</label>
      <input
        type="number"
        maxLength={4}
        minLength={4}
        id="song-year-id3-tag"
        className="mr-2 mt-2 w-[90%] rounded-3xl border-[.15rem] border-surface-2 bg-surface-2 px-4 py-3 text-ink transition-colors focus:border-echo "
        name="song-year"
        placeholder={t('common.releasedYear')}
        value={songYear ?? ''}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const releasedYear = Number(e.currentTarget.value);
          updateSongInfo(
            (prevData): SongTags => ({
              ...prevData,
              releasedYear: releasedYear ?? prevData.releasedYear
            })
          );
        }}
      />
    </div>
  );
};

export default SongYearInput;
