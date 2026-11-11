import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import Button from '../Button';
import Img from '../Img';
import { answerUpdate, updateOfferStore } from '../../other/updateOffer';
import AppIcon from '../../assets/images/webp/logo_light_mode.webp';

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);

/** The release notes as a few short lines: Markdown marks taken off, empty lines and headings dropped. */
const noteLines = (notes?: string) =>
  (notes ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1'))
    .slice(0, 6);

/**
 * An update, offered in Nemora's own frame rather than the system's message box: the version, what
 * is new in it, Update now and Later; then the download and the install, which closes Nemora and
 * opens it again. It sits above the player and leaves the rest of the window usable.
 */
const UpdateCard = () => {
  const offer = useStore(updateOfferStore, (s) => s);
  const { t, i18n } = useTranslation();
  if (!offer) return null;

  const lines = noteLines(offer.notes);
  const released = offer.date && !Number.isNaN(Date.parse(offer.date))
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(new Date(offer.date))
    : undefined;
  const percent =
    offer.totalBytes && offer.totalBytes > 0 ? Math.min(100, (offer.downloadedBytes / offer.totalBytes) * 100) : undefined;

  return (
    <section
      role="dialog"
      aria-labelledby="update-card-title"
      className="update-card fixed bottom-[6.5rem] right-5 z-40 w-[23rem] animate-[appearFromBottom_400ms_var(--ease-out)_forwards] overflow-hidden rounded-dialog border border-glass-border bg-surface-1 translate-y-3 text-ink opacity-0 shadow-float"
    >
      <div className="flex items-center gap-3.5 px-5 pb-3 pt-5">
        <Img src={AppIcon} className="h-11 w-11 shrink-0 rounded-[11px]" alt="" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-small font-medium text-echo">{t(offer.phase === 'offer' ? 'updateCard.available' : 'updateCard.updating')}</span>
          <h2 id="update-card-title" className="m-0 truncate text-title font-semibold leading-tight">
            Nemora {offer.version}
          </h2>
          <span className="text-small text-ink-dim">
            {t('updateCard.youHave', { version: offer.currentVersion })}
            {released && ` · ${t('updateCard.released', { date: released })}`}
          </span>
        </div>
      </div>

      {offer.phase === 'offer' && lines.length > 0 && (
        <div className="mx-5 mb-1 rounded-lg bg-surface-2 px-3.5 py-3">
          <p className="m-0 mb-1.5 text-small font-medium text-ink-dim">{t('updateCard.whatsNew')}</p>
          <ul className="m-0 flex max-h-32 list-none flex-col gap-1 overflow-y-auto p-0 text-small leading-snug">
            {lines.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-echo" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {offer.phase === 'offer' ? (
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3">
          <Button className="!mr-0" variant="ghost" label={t('updateCard.later')} clickHandler={() => answerUpdate(false)} />
          <Button
            className="!mr-0"
            variant="primary"
            iconName="download"
            label={t('updateCard.updateNow')}
            clickHandler={() => answerUpdate(true)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            {offer.phase === 'installing' || percent === undefined ? (
              <div className="h-full w-1/3 animate-[updateSweep_1.2s_ease-in-out_infinite] rounded-full bg-echo" />
            ) : (
              <div className="h-full rounded-full bg-echo transition-[width] duration-200" style={{ width: `${percent}%` }} />
            )}
          </div>
          <span className="text-small tabular-nums text-ink-dim">
            {offer.phase === 'installing'
              ? t('updateCard.installing')
              : offer.totalBytes
                ? t('updateCard.downloading', { done: mb(offer.downloadedBytes), total: mb(offer.totalBytes) })
                : t('updateCard.downloadingSize', { done: mb(offer.downloadedBytes) })}
          </span>
        </div>
      )}
    </section>
  );
};

export default UpdateCard;
