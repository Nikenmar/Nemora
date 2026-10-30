import { useTranslation } from 'react-i18next';

/** While a page's code loads: a small spinner, quiet enough not to flash on fast loads. */
const SuspenseLoader = () => {
  const { t } = useTranslation();

  return (
    <div
      className="flex h-full w-full animate-[tooltipIn_300ms_ease_150ms_both] items-center justify-center gap-2.5 text-small text-ink-dim"
      role="status"
    >
      <span className="h-4 w-4 animate-spin-ease rounded-full border-2 border-line border-t-echo" aria-hidden />
      <span>{t('common.loading')}</span>
    </div>
  );
};

export default SuspenseLoader;
