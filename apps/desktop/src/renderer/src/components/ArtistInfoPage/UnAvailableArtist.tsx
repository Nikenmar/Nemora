import { lazy, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimilarArtist } from 'src/types/last_fm_artist_info_api';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

const OpenLinkConfirmPrompt = lazy(() => import('../OpenLinkConfirmPrompt'));

const UnAvailableArtist = (props: Omit<SimilarArtist, 'artistData'>) => {
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { name, url } = props;

  const handleButtonClick = useCallback(() => {
    return changePromptMenuData(
      true,
      <OpenLinkConfirmPrompt link={url} title={`View '${name}' in Last.Fm`} />,
      'confirm-link-direct'
    );
  }, [changePromptMenuData, name, url]);

  return (
    <button
      type="button"
      className="mb-2 mr-3 flex items-center rounded-3xl bg-surface-2 px-4 py-1 last:mr-0 "
      title={t('artistInfoPage.viewInLastFm', { name })}
      onClick={handleButtonClick}
    >
      <span className="ms-icon mr-2 text-lg text-echo">
        open_in_new
      </span>
      <p className="text-sm">{name}</p>
    </button>
  );
};

export default UnAvailableArtist;
