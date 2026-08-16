import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RecapPeriod, RecapSlide } from '@platform/core/stats/recap';

import RecapSlideView from './RecapSlideView';

type Props = {
  slides: readonly RecapSlide[];
  period: RecapPeriod;
  onClose: () => void;
};

const Recap = ({ slides, period, onClose }: Props) => {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const slide = slides[index];
  const periodMonth = period.kind === 'month' ? period.month : undefined;

  const previous = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const next = useCallback(
    () => setIndex((current) => Math.min(Math.max(0, slides.length - 1), current + 1)),
    [slides.length]
  );

  useEffect(() => {
    setIndex(0);
  }, [period.kind, period.year, periodMonth, slides]);

  useEffect(() => {
    containerRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') previous();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'Escape') onClose();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [next, onClose, previous]);

  const periodLabel =
    period.kind === 'year'
      ? `${period.year}`
      : new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(
          new Date(period.year, period.month - 1, 1)
        );

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('statsPage.recap.title', { period: periodLabel })}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex select-none flex-col overflow-hidden bg-background-color-2 text-font-color-black outline-none dark:bg-dark-background-color-2 dark:text-font-color-white"
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={index >= slides.length - 1}
        className="absolute inset-0 z-0 cursor-default disabled:cursor-default"
        aria-label={t('statsPage.recap.next')}
        onClick={next}
      />
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1.5 px-5 pt-4" aria-hidden="true">
        {slides.map((item, slideIndex) => (
          <span
            key={`${item.kind}-${slideIndex}`}
            className={`h-1 grow rounded-full ${
              slideIndex <= index
                ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight'
                : 'bg-font-color-black/15 dark:bg-font-color-white/15'
            }`}
          />
        ))}
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 pb-3 pt-8">
        <span className="text-sm font-medium opacity-60">{periodLabel}</span>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-background-color-1/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-font-color-highlight dark:hover:bg-dark-background-color-1/50 dark:focus-visible:outline-dark-font-color-highlight"
          aria-label={t('statsPage.recap.close')}
          title={t('statsPage.recap.close')}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <span className="material-icons-round" aria-hidden="true">
            close
          </span>
        </button>
      </header>

      <main
        className="pointer-events-none relative z-10 flex min-h-0 grow items-center justify-center overflow-y-auto px-8 py-10"
        aria-live="polite"
      >
        {slide ? <RecapSlideView slide={slide} /> : <p>{t('statsPage.recap.empty')}</p>}
      </main>

      <footer className="relative z-10 flex items-center justify-between px-5 pb-5 pt-3">
        <button
          type="button"
          disabled={index === 0}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-background-color-1/45 disabled:invisible dark:bg-dark-background-color-1/45"
          aria-label={t('statsPage.recap.previous')}
          title={t('statsPage.recap.previous')}
          onClick={(event) => {
            event.stopPropagation();
            previous();
          }}
        >
          <span className="material-icons-round" aria-hidden="true">
            arrow_back
          </span>
        </button>
        <span className="text-xs opacity-50">
          {t('statsPage.recap.slideProgress', { current: index + 1, total: slides.length })}
        </span>
        <button
          type="button"
          disabled={index >= slides.length - 1}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-background-color-1/45 disabled:invisible dark:bg-dark-background-color-1/45"
          aria-label={t('statsPage.recap.next')}
          title={t('statsPage.recap.next')}
          onClick={(event) => {
            event.stopPropagation();
            next();
          }}
        >
          <span className="material-icons-round" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      </footer>
    </div>
  );
};

export default Recap;
