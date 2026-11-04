import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongFileDetails } from '@platform/ipc';
import parseByteSizes from '../../utils/parseByteSizes';
import SongAdditionalInfoItem from './SongAdditionalInfoItem';
import Button from '../Button';

type Props = { songInfo: SongData; songDurationStr: string; details: SongFileDetails | null };

const SongAdditionalInfoContainer = (props: Props) => {
  const { t } = useTranslation();

  const { songInfo, songDurationStr, details } = props;
  // What the file says about itself, one line for each it has.
  const text = (label: string, value: string | null | undefined) =>
    value ? <SongAdditionalInfoItem label={label} value={value} /> : null;
  const format = songInfo.path.split('.').pop()?.toUpperCase();

  const [isDataVisible, setIsDataVisible] = useState(false);

  return (
    <div className="other-cards appear-from-bottom mr-4 mt-4 w-full max-w-full rounded-xl bg-surface-2/70 p-4 backdrop-blur-sm ">
      <label
        htmlFor="songAdditionalInfo"
        className="title-container flex cursor-pointer items-center justify-between font-medium text-echo"
      >
        <div className="flex items-center">
          <span className="ms-icon mr-2 text-2xl">info</span>{' '}
          {t('songInfoPage.additionalSongInfo')}
        </div>
        <div className="flex items-center">
          <Button
            id="songAdditionalInfo"
            className="!m-0 !border-0 !p-0 outline-1 outline-offset-1 hover:bg-canvas/50 focus-visible:!outline"
            iconClassName="!leading-none !text-3xl"
            iconName={isDataVisible ? 'arrow_drop_up' : 'arrow_drop_down'}
            tooltipLabel={t(`common.${isDataVisible ? 'hideSuggestion' : 'showSuggestion'}`)}
            clickHandler={(e) => {
              e.preventDefault();
              setIsDataVisible((state) => !state);
            }}
          />
        </div>
      </label>

      {isDataVisible && (
        <div className="info-items-container">
          <SongAdditionalInfoItem label={t('common.songTitle')} value={songInfo.title} />
          <SongAdditionalInfoItem label={t('common.duration')} value={songDurationStr} />
          {Array.isArray(songInfo.artists) && songInfo.artists.length > 0 && (
            <SongAdditionalInfoItem
              label={t('common.artist_other')}
              value={songInfo.artists.map((artist) => artist.name).join(', ')}
            />
          )}
          {songInfo.album && (
            <SongAdditionalInfoItem label={t('common.album_one')} value={songInfo.album?.name} />
          )}
          {songInfo?.albumArtists && (
            <SongAdditionalInfoItem
              label={t('common.albumArtists')}
              value={songInfo.albumArtists.map((artist) => artist.name).join(', ')}
            />
          )}
          {Array.isArray(songInfo.genres) && songInfo.genres.length > 0 && (
            <SongAdditionalInfoItem
              label={t('common.genre_other')}
              value={songInfo.genres.map((genre) => genre.name).join(', ')}
            />
          )}
          {songInfo.trackNo && (
            <SongAdditionalInfoItem
              label={t('common.albumTrackNo')}
              value={songInfo.trackNo.toString()}
            />
          )}
          {text(t('common.discNo'), details?.discNo?.toString())}
          {songInfo.year && (
            <SongAdditionalInfoItem
              label={t('common.releasedYear')}
              value={songInfo.year.toString()}
            />
          )}
          {text(t('common.publisher'), details?.publisher)}
          {text(t('common.composer'), details?.composer)}
          {text(t('common.copyright'), details?.copyright)}
          {text(t('common.isrc'), details?.isrc)}
          {text(t('common.bpm'), details?.bpm)}
          <SongAdditionalInfoItem
            label={t('common.songAddedOn')}
            value={new Date(songInfo.addedDate).toUTCString()}
          />
          {songInfo.modifiedDate && (
            <SongAdditionalInfoItem
              label={t('common.lastModifiedOn')}
              value={new Date(songInfo.modifiedDate).toUTCString()}
            />
          )}
          {text(t('common.fileFormat'), format)}
          {text(t('common.sampleRate'), details?.sampleRate ? `${details.sampleRate} Hz` : null)}
          {text(t('common.bitDepth'), details?.bitDepth ? `${details.bitDepth} bit` : null)}
          {text(t('common.bitRate'), details?.bitrateKbps ? `${details.bitrateKbps} Kbps` : null)}
          {text(
            t('common.noOfAudioChannels'),
            details?.channels ? t('common.channelWithCount', { count: details.channels }) : null
          )}
          {text(t('common.fileSize'), details ? parseByteSizes(details.sizeBytes, 1)?.size : null)}
          <SongAdditionalInfoItem label={t('common.songLocation')} value={songInfo.path} />
        </div>
      )}
    </div>
  );
};

export default SongAdditionalInfoContainer;
