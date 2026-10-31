import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { SONG_GUESSR_GUESS_INPUT_ID } from '../../utils/songGuessr/constants';
import { formatCandidateLabel } from '../../utils/songGuessr/matching';
import Button from '../Button';
import Img from '../Img';

type SongGuessrGuessInputProps = {
  disabled: boolean;
  onSubmit: (candidate: SongGuessrCandidate) => void;
  onSkip: () => void;
  attemptsLeft: number;
  /** The attempt log — it owns the area under the buttons on its own. */
  children?: ReactNode;
};

const SEARCH_DEBOUNCE_MS = 120;
/**
 * The list is not capped at a handful of hits any more — searching an artist
 * has to reach every track of theirs. Main ranks the whole library once per
 * query and this pages through that ranking, so only the rows in view exist as
 * DOM nodes and only the rows asked for cross the IPC bridge.
 */
const SEARCH_PAGE_SIZE = 40;
/** Rows are a fixed height so the list can be virtualized without measuring. */
const SUGGESTION_ROW_HEIGHT = 52;
const SUGGESTION_LIST_PADDING = 8;
/** Fetch the next page this many rows before the user reaches the end. */
const LOAD_MORE_LOOKAHEAD = 8;

/* The suggestion list is positioned against the viewport, not the dialog, so
   it can hang past the panel's edge — inside it there is only ever room for a
   couple of rows, which is useless for browsing an artist's whole catalogue.
   Fixed descendants of the dialog are not clipped by its `overflow-hidden`
   (their containing block is the viewport) and, since the dialog is in the top
   layer, they still paint above its backdrop. */
const SUGGESTION_GAP = 8;
const VIEWPORT_MARGIN = 12;
/** Below this the list flips above the input instead of squeezing. */
const MIN_SUGGESTION_HEIGHT = 180;

/**
 * These areas scroll without showing a bar, the way the Stats activity
 * calendar does. The content is short and self-anchoring, so the bar was pure
 * chrome — and the global rules would have coloured it from `.App.dark`, which
 * a dialog portalled to document.body never sees anyway.
 */
const HIDDEN_SCROLLBAR_CLASSNAME =
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const SongGuessrGuessInput = (props: SongGuessrGuessInputProps) => {
  const { disabled, onSubmit, onSkip, attemptsLeft, children } = props;
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<SongGuessrCandidate[]>([]);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<SongGuessrCandidate>();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [suggestionBox, setSuggestionBox] = useState<CSSProperties>();

  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VirtuosoHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const listboxId = 'song-guessr-candidates';

  /* Paging reads these from the callback, which must not be rebuilt on every
     appended page — a new `endReached` identity mid-scroll drops the event. */
  const loadedQueryRef = useRef('');
  const loadedCountRef = useRef(0);
  const totalCandidatesRef = useRef(0);
  const isLoadingMoreRef = useRef(false);

  useEffect(() => {
    loadedCountRef.current = candidates.length;
    totalCandidatesRef.current = totalCandidates;
  }, [candidates, totalCandidates]);

  const hasSuggestions = candidates.length > 0 && !selectedCandidate;
  const hasEmptyResult =
    !isSearching && !selectedCandidate && query.trim().length > 0 && candidates.length === 0;
  const isPopoverOpen = hasSuggestions || hasEmptyResult;

  /* Measured against the input box and re-measured on resize: the dialog is
     centred with `m-auto`, so resizing the window moves the anchor under it. */
  useLayoutEffect(() => {
    if (!isPopoverOpen) {
      setSuggestionBox(undefined);
      return undefined;
    }

    const measure = () => {
      const anchor = inputBoxRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const contentHeight = hasSuggestions
        ? candidates.length * SUGGESTION_ROW_HEIGHT + SUGGESTION_LIST_PADDING
        : SUGGESTION_ROW_HEIGHT;
      const spaceBelow = window.innerHeight - rect.bottom - SUGGESTION_GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - SUGGESTION_GAP - VIEWPORT_MARGIN;
      // Downward unless that side is genuinely cramped — a list that jumps
      // sides while paging in more rows would be worse than a short one.
      const placeBelow = spaceBelow >= MIN_SUGGESTION_HEIGHT || spaceBelow >= spaceAbove;
      const available = Math.max(placeBelow ? spaceBelow : spaceAbove, SUGGESTION_ROW_HEIGHT);

      setSuggestionBox({
        left: rect.left,
        width: rect.width,
        height: Math.min(contentHeight, available),
        ...(placeBelow
          ? { top: rect.bottom + SUGGESTION_GAP }
          : { bottom: window.innerHeight - rect.top + SUGGESTION_GAP })
      });
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [candidates.length, hasSuggestions, isPopoverOpen]);

  // The parent remounts this on every attempt and every new round, which drops
  // focus on the floor. Typing is the only thing to do here, so take it back.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // With the bar hidden, the log has to anchor itself: the newest attempt is
  // the one worth reading, so it stays in view without anyone dragging it.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [attemptsLeft]);

  useEffect(() => {
    requestIdRef.current += 1;
    if (selectedCandidate) {
      setIsSearching(false);
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      loadedQueryRef.current = '';
      setCandidates([]);
      setTotalCandidates(0);
      setActiveIndex(-1);
      setIsSearching(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setIsSearching(true);
      window.api.songGuessr
        .searchCandidates(trimmedQuery, SEARCH_PAGE_SIZE, 0)
        .then((result) => {
          if (requestId !== requestIdRef.current) return;
          loadedQueryRef.current = trimmedQuery;
          setCandidates(result.candidates);
          setTotalCandidates(result.total);
          setActiveIndex(result.candidates.length > 0 ? 0 : -1);
          setIsSearching(false);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          loadedQueryRef.current = '';
          setCandidates([]);
          setTotalCandidates(0);
          setActiveIndex(-1);
          setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      requestIdRef.current += 1;
    };
  }, [query, selectedCandidate]);

  const loadMoreCandidates = useCallback(() => {
    const loadedQuery = loadedQueryRef.current;
    const loadedCount = loadedCountRef.current;

    if (isLoadingMoreRef.current || !loadedQuery) return;
    if (loadedCount === 0 || loadedCount >= totalCandidatesRef.current) return;

    const requestId = requestIdRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    window.api.songGuessr
      .searchCandidates(loadedQuery, SEARCH_PAGE_SIZE, loadedCount)
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        // Appending only onto the exact list this page was asked for keeps a
        // late answer from stitching itself into a different query's results.
        setCandidates((current) =>
          current.length === loadedCount ? [...current, ...result.candidates] : current
        );
        setTotalCandidates(result.total);
      })
      .finally(() => {
        isLoadingMoreRef.current = false;
        if (requestId === requestIdRef.current) setIsLoadingMore(false);
      })
      .catch(() => undefined);
  }, []);

  // Keyboard navigation has to drag the highlighted row into view, since the
  // list scrolls inside its own fixed area — and pull the next page in before
  // arrowing off the end of the loaded ones.
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.scrollIntoView({ index: activeIndex });
    if (activeIndex >= loadedCountRef.current - LOAD_MORE_LOOKAHEAD) loadMoreCandidates();
  }, [activeIndex, loadMoreCandidates]);

  const selectCandidate = (candidate: SongGuessrCandidate) => {
    setSelectedCandidate(candidate);
    setQuery(formatCandidateLabel(candidate));
    loadedQueryRef.current = '';
    setCandidates([]);
    setTotalCandidates(0);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const clearSelection = () => {
    setSelectedCandidate(undefined);
    setQuery('');
    loadedQueryRef.current = '';
    setCandidates([]);
    setTotalCandidates(0);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (selectedCandidate && !disabled) onSubmit(selectedCandidate);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
      return;
    }
    if (event.key === 'ArrowUp' && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? candidates.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      requestIdRef.current += 1;
      loadedQueryRef.current = '';
      setCandidates([]);
      setTotalCandidates(0);
      setActiveIndex(-1);
      setIsSearching(false);
      return;
    }
    if (event.key === 'Enter') {
      if (activeIndex >= 0 && candidates[activeIndex]) {
        event.preventDefault();
        selectCandidate(candidates[activeIndex]);
      } else if (selectedCandidate) {
        event.preventDefault();
        submit();
      }
    }
  };

  const renderCandidate = (index: number, candidate: SongGuessrCandidate) => (
    <div
      id={`${listboxId}-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      /* Out of the tab order — the combobox keeps focus and drives the list
         through aria-activedescendant — but focusable enough to be a real
         option rather than a div wearing the role. */
      tabIndex={-1}
      style={{ height: SUGGESTION_ROW_HEIGHT }}
      className={`mx-[5px] flex cursor-pointer items-center gap-3 rounded-lg px-2.5 transition-colors duration-100 motion-reduce:transition-none ${
        index === activeIndex ? 'bg-glass-hover' : ''
      }`}
      onMouseEnter={() => setActiveIndex(index)}
      onMouseDown={(event) => {
        event.preventDefault();
        selectCandidate(candidate);
      }}
    >
      {candidate.artworkPath ? (
        <Img
          src={candidate.artworkPath}
          alt=""
          enableImgFadeIns={false}
          className="h-9 w-9 flex-shrink-0 rounded-cover-sm object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-cover-sm bg-surface-2 text-ink-faint">
          <span className="ms-icon text-base !leading-none">
            music_note
          </span>
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body text-ink">{candidate.title}</span>
        {candidate.artists.length > 0 && (
          <span className="truncate text-small text-ink-dim">{candidate.artists.join(', ')}</span>
        )}
      </span>
    </div>
  );

  const isBusy = isSearching || isLoadingMore;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={inputBoxRef}
        className={`flex h-11 flex-shrink-0 items-center gap-2 rounded-full border bg-surface-2 pl-3.5 pr-1.5 transition-colors duration-150 focus-within:border-echo motion-reduce:transition-none ${
          selectedCandidate ? 'border-echo' : 'border-line'
        }`}
      >
        <span
          className={`ms-icon text-xl !leading-none ${
            selectedCandidate ? 'ms-icon-filled text-echo' : 'text-ink-faint'
          }`}
          aria-hidden="true"
        >
          {selectedCandidate ? 'task_alt' : 'search'}
        </span>

        <input
          ref={inputRef}
          id={SONG_GUESSR_GUESS_INPUT_ID}
          type="text"
          value={query}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={hasSuggestions}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            hasSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
          }
          aria-label={t('songGuessr.guessInputLabel')}
          placeholder={t('songGuessr.guessPlaceholder')}
          className="h-full w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint focus-visible:!outline-none disabled:opacity-50"
          onChange={(event) => {
            setSelectedCandidate(undefined);
            setQuery(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />

        {/* How much of the ranking is in hand: with thousands of matches the
            hidden scrollbar gives no sense of depth on its own. */}
        {hasSuggestions && (
          <span className="flex-shrink-0 text-small tabular-nums text-ink-faint">
            {t('songGuessr.searchCount', { shown: candidates.length, total: totalCandidates })}
          </span>
        )}

        {isBusy && (
          <span
            className="ms-icon animate-spin text-base !leading-none text-ink-faint motion-reduce:animate-none"
            aria-hidden="true"
          >
            progress_activity
          </span>
        )}

        {query.length > 0 && !disabled && (
          <button
            type="button"
            onClick={clearSelection}
            aria-label={t('songGuessr.clearGuess')}
            title={t('songGuessr.clearGuess')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-line/70 hover:text-ink motion-reduce:transition-none"
          >
            <span className="ms-icon text-base !leading-none">close</span>
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-shrink-0 items-center gap-2">
        <Button
          label={t('songGuessr.submitGuess')}
          variant="primary"
          size="lg"
          isDisabled={disabled || !selectedCandidate}
          removeFocusOnClick={false}
          className="m-0 flex-1"
          clickHandler={submit}
        />
        <Button
          label={t('songGuessr.skip')}
          iconName="skip_next"
          variant="outline"
          size="lg"
          tooltipLabel={t('songGuessr.skipHint', { count: attemptsLeft })}
          isDisabled={disabled}
          removeFocusOnClick={false}
          className="m-0"
          clickHandler={onSkip}
        />
      </div>

      {/*
        The attempt log owns this area outright: the suggestions float over the
        dialog now instead of sharing the space, so opening the list moves
        nothing and all six attempts fit here without scrolling.
      */}
      <div
        ref={logRef}
        className={`mt-4 min-h-0 flex-1 overflow-y-auto ${HIDDEN_SCROLLBAR_CLASSNAME}`}
      >
        {children}
      </div>

      {isPopoverOpen && suggestionBox && (
        <div
          id={listboxId}
          role={hasSuggestions ? 'listbox' : undefined}
          aria-label={hasSuggestions ? t('songGuessr.guessInputLabel') : undefined}
          style={suggestionBox}
          className="fixed z-10 overflow-hidden rounded-menu border border-glass-border bg-glass py-[5px] text-ink shadow-float backdrop-blur-[26px] backdrop-saturate-[1.7]"
        >
          {hasSuggestions ? (
            <Virtuoso
              ref={listRef}
              data={candidates}
              className={HIDDEN_SCROLLBAR_CLASSNAME}
              style={{ height: '100%' }}
              fixedItemHeight={SUGGESTION_ROW_HEIGHT}
              increaseViewportBy={SUGGESTION_ROW_HEIGHT * 5}
              endReached={loadMoreCandidates}
              itemContent={renderCandidate}
            />
          ) : (
            <p className="flex h-full items-center px-3 text-small text-ink-dim">
              {t('songGuessr.noCandidates')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SongGuessrGuessInput;
