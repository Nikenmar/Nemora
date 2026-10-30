import { useTranslation } from 'react-i18next';

type Props = {
  songComposer?: string;
  updateSongInfo: (_callback: (_prevSongInfo: SongTags) => SongTags) => void;
};

const SongComposerInput = (props: Props) => {
  const { songComposer, updateSongInfo } = props;
  const { t } = useTranslation();

  return (
    <div className="tag-input flex min-w-[10rem] max-w-2xl flex-col">
      <label htmlFor="song-composer-id3-tag">{t('songTagsEditingPage.composer')}</label>
      <input
        type="text"
        id="song-composer-id3-tag"
        className="mr-2 mt-2 w-[90%] rounded-3xl border-[.15rem] border-surface-2 bg-surface-2 px-4 py-3 text-ink transition-colors focus:border-echo "
        name="song-composer"
        placeholder={t('songTagsEditingPage.composer')}
        value={songComposer ?? ''}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const composer = e.currentTarget.value;
          updateSongInfo((prevData) => ({ ...prevData, composer }));
        }}
      />
    </div>
  );
};

export default SongComposerInput;
