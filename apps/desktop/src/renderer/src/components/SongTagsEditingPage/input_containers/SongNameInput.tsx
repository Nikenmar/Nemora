import { useTranslation } from 'react-i18next';

type Props = {
  songTitle: string;
  updateSongInfo: (_callback: (_prevSongInfo: SongTags) => SongTags) => void;
};

const SongNameInput = (props: Props) => {
  const { t } = useTranslation();

  const { updateSongInfo, songTitle } = props;
  return (
    <div className="tag-input flex min-w-[10rem] max-w-2xl flex-col">
      <label htmlFor="song-name-id3-tag">{t('songTagsEditingPage.songName')}</label>
      <input
        type="text"
        id="song-name-id3-tag"
        className="mr-2 mt-2 w-[90%] rounded-3xl border-[.15rem] border-surface-2 bg-surface-2 px-4 py-3 text-ink transition-colors focus:border-echo "
        name="song-name"
        placeholder={t('songTagsEditingPage.songName')}
        value={songTitle}
        onChange={(e) => {
          const title = e.currentTarget.value;
          updateSongInfo((prevData) => ({ ...prevData, title }));
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default SongNameInput;
