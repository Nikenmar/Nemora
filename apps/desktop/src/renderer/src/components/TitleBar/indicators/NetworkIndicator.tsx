import { useTranslation } from 'react-i18next';
import useNetworkConnectivity from '../../../hooks/useNetworkConnectivity';

const NetworkIndicator = () => {
  const { t } = useTranslation();

  const { isOnline } = useNetworkConnectivity();

  return (
    <div
      className={`network-indicator group mr-1 flex cursor-pointer items-center justify-center rounded-md bg-surface-2 px-3 py-1 text-center transition-[background] ${
        isOnline && 'invisible hidden !transition-[visibility] delay-[2500ms] duration-150'
      }`}
      title={t(`common.${isOnline ? 'hasInternet' : 'noInternet'}`)}
    >
      <span
        className={`ms-icon py-[2px] leading-none group-hover:text-echo ${
          isOnline &&
          'invisible text-echo opacity-0 transition-[opacity,visibility] delay-[2500ms] duration-200'
        }`}
      >
        {isOnline ? 'wifi' : 'wifi_off'}
      </span>
    </div>
  );
};

export default NetworkIndicator;
