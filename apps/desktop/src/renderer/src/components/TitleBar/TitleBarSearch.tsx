import { useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store';
import Icon from '../ui/Icon';

/** Focuses the search field from anywhere (Ctrl+K, Ctrl+F; App.tsx). */
export const FOCUS_SEARCH_EVENT = 'nemora:focus-search';

/**
 * The search field of the top bar. Typing opens the Search page and drives it live through the
 * page's `keyword`; on the Search page the field shows that keyword, elsewhere it is empty.
 */
const TitleBarSearch = () => {
  const { t } = useTranslation();
  const { changeCurrentActivePage, updateCurrentlyActivePageData } = useContext(AppUpdateContext);
  const currentlyActivePage = useStore(store, (state) => state.currentlyActivePage);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearchPage = currentlyActivePage.pageTitle === 'Search';
  const keyword = onSearchPage ? ((currentlyActivePage.data?.keyword as string) ?? '') : '';

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  const setKeyword = (value: string) => {
    if (onSearchPage) updateCurrentlyActivePageData((data) => ({ ...data, keyword: value }));
    else if (value) changeCurrentActivePage('Search', { keyword: value });
  };

  return (
    <label className="title-bar-search group relative mx-auto flex h-9 w-full max-w-[32rem] items-center gap-2.5 rounded-full bg-surface-2 pl-3.5 pr-2 text-ink-dim transition-colors duration-150 hover:bg-line/60 focus-within:bg-line/60 focus-within:text-ink">
      <Icon name="search" size={18} />
      <input
        ref={inputRef}
        id="titleBarSearch"
        type="search"
        value={keyword}
        placeholder={t('titleBar.searchPlaceholder', 'Search songs, artists, albums')}
        aria-label={t('titleBar.search', 'Search')}
        autoComplete="off"
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-dim focus-visible:!outline-none [&::-webkit-search-cancel-button]:hidden"
        onFocus={() => {
          if (!onSearchPage && keyword === '') changeCurrentActivePage('Search');
        }}
        onChange={(e) => setKeyword(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (keyword) setKeyword('');
            else e.currentTarget.blur();
          }
        }}
      />
      {keyword ? (
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-full text-ink-dim hover:bg-line hover:text-ink"
          aria-label={t('titleBar.clearSearch', 'Clear search')}
          onClick={() => {
            setKeyword('');
            inputRef.current?.focus();
          }}
        >
          <Icon name="close" size={14} />
        </button>
      ) : (
        <kbd className="rounded-[5px] border border-line px-1.5 py-px font-[inherit] text-[10.5px] text-ink-faint group-focus-within:hidden">
          Ctrl K
        </kbd>
      )}
    </label>
  );
};

export default TitleBarSearch;
