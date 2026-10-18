import { useTranslation } from 'react-i18next';

import { TOURNAMENT_SIZES, type TournamentSize } from '@platform/core/stats/tournaments';

import Button from '../../Button';

interface TournamentSetupProps {
  trackCount: number;
  isBusy: boolean;
  onStart: (size: TournamentSize) => void;
}

const TournamentSetup = ({ trackCount, isBusy, onStart }: TournamentSetupProps) => {
  const { t } = useTranslation();

  return (
    <section className="rounded-xl bg-background-color-2/60 p-5 dark:bg-dark-background-color-2/60">
      <h3 className="text-lg font-medium">{t('duels.tournament.newTournament')}</h3>
      <p className="mt-1 text-sm opacity-70">{t('duels.tournament.description')}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {TOURNAMENT_SIZES.map((size) => (
          <Button
            key={size}
            label={t('duels.tournament.size', { count: size })}
            iconName="account_tree"
            isDisabled={isBusy || trackCount < size}
            tooltipLabel={
              trackCount < size
                ? t('duels.tournament.notEnoughTracks', { count: size })
                : t('duels.tournament.startSize', { count: size })
            }
            className="!m-0"
            clickHandler={() => onStart(size)}
          />
        ))}
      </div>
    </section>
  );
};

export default TournamentSetup;
