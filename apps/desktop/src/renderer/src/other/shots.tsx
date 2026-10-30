/**
 * The redesign's screenshot stand (tools/redesign/shots.mjs). In a `--bench` run only, the app's own
 * navigation and overlays are put on `window.__nemoraShots`, so the stand opens every surface the
 * way the app does instead of clicking through a DOM the redesign keeps changing. Inert without the
 * flag.
 */
import { lazy, type ReactNode } from 'react';

import { isBenchRun } from './bench';
import ErrorPrompt from '../components/ErrorPrompt';
import OpenLinkConfirmPrompt from '../components/OpenLinkConfirmPrompt';
import SensitiveActionConfirmPrompt from '../components/SensitiveActionConfirmPrompt';

const AppShortcutsPrompt = lazy(() => import('../components/SettingsPage/AppShortcutsPrompt'));
const ReleaseNotesPrompt = lazy(() => import('../components/ReleaseNotesPrompt/ReleaseNotesPrompt'));
const Showcase = lazy(() => import('../components/ui/Showcase'));

export interface ShotsBridge {
  changeCurrentActivePage: (page: PageTitles, data?: PageData) => void;
  changePromptMenuData: (isVisible?: boolean, prompt?: ReactNode | null, className?: string) => void;
  updatePlayerType: (type: PlayerTypes) => void;
  addNewNotifications: (notifications: AppNotification[]) => void;
  toggleMutedState: (isMute?: boolean) => void;
  playSong: (songId: string, isStartPlay?: boolean) => void;
  createQueue: (
    queue: string[],
    queueType: QueueTypes,
    isShuffleQueue?: boolean,
    queueId?: string,
    startPlaying?: boolean
  ) => void;
  updateSongPosition: (position: number) => void;
  togglePlay: (isPlay?: boolean) => void;
  currentPage: () => PageTitles;
}

/** The prompts a shot can open by name: one of each kind the redesign restyles. */
const PROMPTS: Record<string, () => [ReactNode, string?]> = {
  shortcuts: () => [<AppShortcutsPrompt key="shortcuts" />],
  showcase: () => [<Showcase key="showcase" />, '!max-w-[70rem]'],
  releaseNotes: () => [<ReleaseNotesPrompt key="releaseNotes" />, 'release-notes px-8 py-4'],
  confirm: () => [
    <SensitiveActionConfirmPrompt
      key="confirm"
      title="Delete tierlist"
      content="Summer 2026 and its 42 placements will be removed. Songs stay in the library."
      confirmButton={{ label: 'Delete', iconName: 'delete', clickHandler: () => undefined }}
    />
  ],
  openLink: () => [
    <OpenLinkConfirmPrompt key="openLink" link="https://github.com/Nikenmar/Nemora/issues" />
  ],
  error: () => [<ErrorPrompt key="error" reason="JUST_FOR_FUN" />]
};

let registered = false;

export function registerShots(bridge: ShotsBridge) {
  void isBenchRun().then((bench) => {
    if (!bench) return;
    (window as unknown as { __nemoraShots: unknown }).__nemoraShots = {
      ...bridge,
      /** Opens a page without the "already on this page" notice the app shows for a repeat. */
      go: (page: PageTitles, data?: PageData) => {
        if (bridge.currentPage() === page && !data) return;
        bridge.changeCurrentActivePage(page, data);
      },
      prompt: (name: string) => {
        const make = PROMPTS[name];
        if (!make) throw new Error(`no prompt called ${name}`);
        const [prompt, className] = make();
        bridge.changePromptMenuData(true, prompt, className);
      },
      closePrompt: () => bridge.changePromptMenuData(false, null)
    };
    if (!registered) {
      registered = true;
      console.info('[shots] stand hooks ready');
    }
  });
}
