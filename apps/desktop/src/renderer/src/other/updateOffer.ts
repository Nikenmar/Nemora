/**
 * The update offer, between the updater (platform/updater) and the card that shows it (UpdateCard).
 *
 * The updater used to ask through the system's own message box, the one unstyled window left in
 * Nemora. It now asks here: `askToUpdate` shows the card and resolves with the answer, and
 * `reportProgress` moves it on to the download. Nothing else in the app reads this store.
 */
import { Store } from '@tanstack/react-store';

export type UpdatePhase = 'offer' | 'downloading' | 'installing';

export interface UpdateOffer {
  version: string;
  currentVersion: string;
  /** The release's notes, as the update feed has them (plain text or Markdown). */
  notes?: string;
  date?: string;
  phase: UpdatePhase;
  downloadedBytes: number;
  totalBytes?: number;
}

export const updateOfferStore = new Store<UpdateOffer | null>(null);

let answer: ((accepted: boolean) => void) | undefined;

/** Shows the offer and waits for Update now (true) or Later (false). */
export const askToUpdate = (offer: Pick<UpdateOffer, 'version' | 'currentVersion' | 'notes' | 'date'>) =>
  new Promise<boolean>((resolve) => {
    answer?.(false);
    answer = resolve;
    updateOfferStore.setState(() => ({ ...offer, phase: 'offer', downloadedBytes: 0 }));
  });

/** The card's buttons. */
export const answerUpdate = (accepted: boolean) => {
  const resolve = answer;
  answer = undefined;
  if (accepted) updateOfferStore.setState((s) => (s ? { ...s, phase: 'downloading' } : s));
  else updateOfferStore.setState(() => null);
  resolve?.(accepted);
};

export const reportProgress = (progress: { downloadedBytes: number; totalBytes?: number; finished: boolean }) =>
  updateOfferStore.setState((s) =>
    s
      ? {
          ...s,
          phase: progress.finished ? 'installing' : 'downloading',
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes ?? s.totalBytes
        }
      : s
  );

/** A download that failed takes the card away; the next start offers the update again. */
export const dismissUpdate = () => {
  answer = undefined;
  updateOfferStore.setState(() => null);
};
