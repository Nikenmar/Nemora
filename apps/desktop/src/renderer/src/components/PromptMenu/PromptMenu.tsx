 

/* eslint-disable jsx-a11y/click-events-have-key-events */
import { type MutableRefObject, Suspense, useCallback, useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Button from '../Button';
import MainContainer from '../MainContainer';
import PromptMenuNavigationControlsContainer from './PromptMenuNavigationControlsContainer';
import SuspenseLoader from '../SuspenseLoader';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store';

const PromptMenu = () => {
  const promptMenuData = useStore(store, (state) => state.promptMenuData);
  const { changePromptMenuData, updatePromptMenuHistoryIndex } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const promptMenuRef = useRef(null) as unknown as MutableRefObject<HTMLDialogElement>;

  useEffect(() => {
    const dialog = promptMenuRef.current;

    if (promptMenuData.isVisible && dialog && !dialog.open) dialog.showModal();
  }, [promptMenuData.isVisible]);

  useEffect(() => {
    const dialog = promptMenuRef.current;

    const manageDialogClose = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const isCursorInDialogBoundary =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;

      if (!isCursorInDialogBoundary) changePromptMenuData(false);
    };

    const manageDialogAnimationEnd = () => {
      if (!promptMenuData.isVisible) {
        dialog.close();
        changePromptMenuData(false, null);
      }
    };

    if (dialog) {
      dialog.addEventListener('click', manageDialogClose);
      dialog.addEventListener('animationend', manageDialogAnimationEnd);
    }

    return () => {
      dialog?.removeEventListener('click', manageDialogClose);
      dialog?.removeEventListener('animationend', manageDialogAnimationEnd);
    };
  }, [promptMenuData.isVisible, changePromptMenuData]);

  const manageKeyboardShortcuts = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.stopPropagation();
        if (e.code === 'ArrowRight') updatePromptMenuHistoryIndex('increment');
        if (e.code === 'ArrowLeft') updatePromptMenuHistoryIndex('decrement');
      }
    },
    [updatePromptMenuHistoryIndex]
  );

  const manageDialogCloseEvent = useCallback(() => {
    changePromptMenuData(false, null);
  }, [changePromptMenuData]);

  useEffect(() => {
    const promptMenu = promptMenuRef.current;

    promptMenu?.addEventListener('close', manageDialogCloseEvent);
    promptMenu?.addEventListener('keydown', manageKeyboardShortcuts);
    return () => {
      promptMenu?.removeEventListener('keydown', manageKeyboardShortcuts);
      promptMenu?.removeEventListener('close', manageDialogCloseEvent);
    };
  }, [manageDialogCloseEvent, manageKeyboardShortcuts]);

  // A prompt's width classes (`!max-w-...`, `!w-...`) size the dialog itself; the rest style its
  // content. On the content alone they could never change the dialog's width.
  const classes = (promptMenuData.className ?? '').split(/\s+/).filter(Boolean);
  const isWidth = (c: string) => /^!?(max-w|min-w|w)-/.test(c);
  const dialogWidth = classes.filter(isWidth).join(' ');
  const contentClasses = classes.filter((c) => !isWidth(c)).join(' ');

  return (
    <dialog
      className={`dialog-menu relative left-1/2 top-1/2 flex h-fit [&:not([open])]:hidden max-h-[86%] w-[min(56rem,92vw)] min-w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog border border-glass-border bg-surface-1 pb-6 text-ink shadow-float open:backdrop:transition-[background-color] ${
        promptMenuData.isVisible
          ? 'open:animate-dialog-appear-ease-in-out open:backdrop:bg-scrim'
          : 'animate-dialog-dissappear-ease-in-out backdrop:bg-transparent'
      } ${dialogWidth}`}
      id="prompt-menu"
      onClick={(e) => {
        e.stopPropagation();
      }}
      ref={promptMenuRef}
    >
      <div className="flex w-full shrink-0 items-center justify-between px-4 pb-1 pt-3">
        <PromptMenuNavigationControlsContainer />
        <Button
          key={0}
          className="prompt-menu-close-btn !m-0"
          iconName="close"
          tooltipLabel={t('titleBar.close')}
          clickHandler={(e) => {
            e.stopPropagation();
            changePromptMenuData(false);
          }}
        />
      </div>
      <MainContainer
        className={`prompt-menu-inner relative max-h-full overflow-y-auto !pl-7 !pr-7 !pt-1 pb-2 text-body text-ink ${contentClasses}`}
      >
        <Suspense fallback={<SuspenseLoader />}>{promptMenuData.prompt}</Suspense>
      </MainContainer>
    </dialog>
  );
};

export default PromptMenu;
