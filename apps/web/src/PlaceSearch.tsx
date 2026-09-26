import type { PlaceAttribution, PlaceResult, SearchLanguage } from '@atlas-os/core';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { PlaceAnswer } from './api.js';
import { searchPlaces } from './api.js';

/** Quiet time after the last keystroke before a query is sent. */
export const SEARCH_DEBOUNCE_MS = 200;
/** Queries shorter than this, not counting whitespace, are never sent. */
export const MIN_QUERY_CHARACTERS = 2;

const ZWNJ = String.fromCodePoint(0x200c);

type Messages = Record<
  | 'label'
  | 'placeholder'
  | 'searching'
  | 'none'
  | 'starting'
  | 'unavailable'
  | 'notInstalled'
  | 'failed'
  | 'invalid',
  string
> & { readonly count: (count: number) => string };

export const MESSAGES: Readonly<Record<SearchLanguage, Messages>> = {
  en: {
    count: (count) => (count === 1 ? '1 place found' : `${count} places found`),
    failed: 'Search returned an unusable answer. Try again.',
    invalid: 'Type at least two letters.',
    label: 'Search places',
    none: 'No places found',
    notInstalled: 'Search is not installed for this dataset.',
    placeholder: 'Search places',
    searching: 'Searching…',
    starting: 'Search is starting. Try again in a moment.',
    unavailable: 'Search is unavailable right now.',
  },
  fa: {
    count: (count) => `${count.toLocaleString('fa-IR')} مکان یافت شد`,
    failed: `پاسخ جستجو قابل${ZWNJ}استفاده نبود. دوباره تلاش کنید.`,
    invalid: 'دست کم دو حرف بنویسید.',
    label: 'جستجوی مکان',
    none: 'مکانی یافت نشد',
    notInstalled: 'جستجو برای این داده نصب نشده است.',
    placeholder: 'جستجوی مکان',
    searching: 'در حال جستجو…',
    starting: `جستجو در حال آماده${ZWNJ}سازی است. کمی بعد دوباره تلاش کنید.`,
    unavailable: 'جستجو اکنون در دسترس نیست.',
  },
};

/** Code points that are not whitespace, which is how the API counts query length too. */
export function significantCharacters(text: string): number {
  return [...text].filter((character) => !/\s/u.test(character)).length;
}

/** One line of address context under a result's name. */
export function addressLine(place: PlaceResult): string {
  const address = place.address;
  const parts = [
    address['street'] !== undefined && address['housenumber'] !== undefined
      ? `${address['street']} ${address['housenumber']}`
      : address['street'],
    address['district'],
    address['city'],
    address['state'],
  ].filter((part): part is string => part !== undefined && part !== place.name);
  return [...new Set(parts)].join('، ');
}

export function AttributionNote({ attribution }: { readonly attribution: PlaceAttribution }) {
  return (
    <p className="search-attribution" data-testid="search-attribution">
      {attribution.url === null ? (
        attribution.text
      ) : (
        // A navigational link only; nothing on this page ever fetches it.
        <a href={attribution.url} rel="noreferrer" target="_blank">
          {attribution.text}
        </a>
      )}
    </p>
  );
}

type Phase =
  | { readonly state: 'idle' }
  | { readonly state: 'searching' }
  | {
      readonly state: 'results';
      readonly results: readonly PlaceResult[];
      readonly attribution: PlaceAttribution;
    }
  | { readonly state: 'message'; readonly message: keyof Messages };

function messageFor(answer: Exclude<PlaceAnswer, { kind: 'ok' }>): keyof Messages {
  if (answer.kind === 'invalid') return 'invalid';
  if (answer.kind === 'failed') return 'failed';
  if (answer.reason === 'not_installed' || answer.reason === 'component_missing') {
    return 'notInstalled';
  }
  return answer.reason === 'starting' ? 'starting' : 'unavailable';
}

export interface PlaceSearchProps {
  readonly language: SearchLanguage;
  /** False when the active dataset has no search at all; the field is then disabled. */
  readonly installed: boolean;
  /** The snapshot the map is currently drawing. Answers from any other one are dropped. */
  readonly snapshotId: string;
  readonly onSelect: (place: PlaceResult) => void;
  /** Called when an answer came from a different snapshot than the one on screen. */
  readonly onSnapshotChanged: () => void;
}

/**
 * Place search as a WAI-ARIA combobox with a list popup.
 *
 * Every keystroke restarts a short debounce; each query that is sent aborts the one before it and
 * carries a sequence number, so only the newest answer is ever shown. An answer from a snapshot
 * other than the one on the map is dropped rather than shown against the wrong map.
 */
export function PlaceSearch({
  installed,
  language,
  onSelect,
  onSnapshotChanged,
  snapshotId,
}: PlaceSearchProps) {
  const messages = MESSAGES[language];
  const listId = useId();
  const statusId = useId();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (text: string) => {
      cancel();
      const ticket = (sequence.current += 1);
      if (significantCharacters(text) < MIN_QUERY_CHARACTERS) {
        setPhase({ state: 'idle' });
        setOpen(false);
        return;
      }
      timer.current = setTimeout(() => {
        const abort = new AbortController();
        controller.current = abort;
        setPhase({ state: 'searching' });
        searchPlaces(text, language, abort.signal).then(
          (answer) => {
            // Only the newest query may change what is shown.
            if (ticket !== sequence.current) return;
            if (answer.kind !== 'ok') {
              setPhase({ message: messageFor(answer), state: 'message' });
              setOpen(false);
              return;
            }
            if (answer.snapshotId !== snapshotId) {
              setPhase({ state: 'idle' });
              setOpen(false);
              onSnapshotChanged();
              return;
            }
            setPhase({
              attribution: answer.attribution,
              results: answer.results,
              state: 'results',
            });
            setActive(answer.results.length > 0 ? 0 : -1);
            setOpen(answer.results.length > 0);
          },
          () => {
            if (ticket !== sequence.current || abort.signal.aborted) return;
            setPhase({ message: 'failed', state: 'message' });
            setOpen(false);
          },
        );
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancel, language, onSnapshotChanged, snapshotId],
  );

  // A language change asks the same question again, in the new language.
  const lastLanguage = useRef(language);
  useEffect(() => {
    if (lastLanguage.current === language) return;
    lastLanguage.current = language;
    if (query.length > 0) run(query);
  }, [language, query, run]);

  const results = phase.state === 'results' ? phase.results : [];

  const choose = (index: number) => {
    const place = results[index];
    if (place === undefined) return;
    cancel();
    sequence.current += 1;
    setOpen(false);
    setQuery(place.name);
    onSelect(place);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open && results.length > 0) {
          setOpen(true);
          setActive(0);
        } else if (results.length > 0) {
          setActive((current) => (current + 1) % results.length);
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (results.length > 0) {
          setOpen(true);
          setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
        }
        return;
      case 'Enter':
        if (open && active >= 0) {
          event.preventDefault();
          choose(active);
        }
        return;
      case 'Escape':
        event.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          cancel();
          sequence.current += 1;
          setQuery('');
          setPhase({ state: 'idle' });
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
  };

  const status = !installed
    ? messages.notInstalled
    : phase.state === 'searching'
      ? messages.searching
      : phase.state === 'results'
        ? phase.results.length === 0
          ? messages.none
          : messages.count(phase.results.length)
        : phase.state === 'message'
          ? (messages[phase.message] as string)
          : '';

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className="place-search" data-testid="place-search" lang={language}>
      <label className="search-label" htmlFor={`${listId}-input`}>
        {messages.label}
      </label>
      <div className="search-field">
        <input
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={statusId}
          aria-expanded={open}
          autoComplete="off"
          data-testid="search-input"
          dir="auto"
          disabled={!installed}
          id={`${listId}-input`}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            run(event.target.value);
          }}
          onFocus={() => setOpen(results.length > 0)}
          onKeyDown={onKeyDown}
          placeholder={messages.placeholder}
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>
      <ul
        aria-label={messages.label}
        className="search-results"
        data-testid="search-results"
        hidden={!open}
        id={listId}
        role="listbox"
      >
        {results.map((place, index) => (
          <li
            aria-selected={index === active}
            className={index === active ? 'active' : ''}
            data-place-id={place.id}
            dir="auto"
            id={optionId(index)}
            key={place.id}
            // Keeps focus in the field, so the combobox never loses its keyboard context.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
            role="option"
          >
            <span className="result-name">{place.name}</span>
            <span className="result-context">{addressLine(place)}</span>
          </li>
        ))}
      </ul>
      <p
        aria-live="polite"
        className="search-status"
        data-testid="search-status"
        id={statusId}
        role="status"
      >
        {status}
      </p>
      {phase.state === 'results' && <AttributionNote attribution={phase.attribution} />}
    </div>
  );
}
