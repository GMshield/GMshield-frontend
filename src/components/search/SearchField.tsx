'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { NamedIcon } from '../Icons';
import styles from './SearchField.module.css';
import { focusSearchField, searchHref } from './search-address';

export type SearchFieldProps = {
  readonly labels: {
    /** The field's name, "Buscar nas fontes". */
    readonly label: string;
    readonly placeholder: string;
    /** The search button's name on a phone, where the field gives way to it. */
    readonly open: string;
  };
};

/**
 * The context bar's search field (Story 3.9): a search runs on Enter only, never while typing, and opens `/search?q=…`
 * (a plain form to `/search` without JavaScript). Esc in the field clears it. `/` focuses it from anywhere, unless a
 * field, an editable text or a dialog has focus (`focusSearchField`: on a phone, where the field is hidden, the search
 * page's own field). Under 768px the field gives way to a search button that opens `/search`.
 */
export function SearchField({ labels }: SearchFieldProps) {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (focusSearchField(event, document)) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = value.trim();
    if (query === '') {
      return;
    }
    setValue('');
    input.current?.blur();
    router.push(searchHref({ query }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setValue('');
    }
  }

  return (
    <>
      <form role="search" action="/search" className={styles.form} aria-label={labels.label} onSubmit={submit}>
        <label className={styles.hidden} htmlFor={id}>
          {labels.label}
        </label>
        <span className={styles.icon} aria-hidden="true">
          <NamedIcon name="search" size={18} />
        </span>
        <input
          ref={input}
          id={id}
          className={styles.input}
          type="search"
          name="q"
          value={value}
          placeholder={labels.placeholder}
          autoComplete="off"
          enterKeyHint="search"
          aria-keyshortcuts="/"
          data-search-field="bar"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className={styles.key} aria-hidden="true">
          /
        </kbd>
      </form>
      <Link className={styles.open} href="/search" aria-label={labels.open}>
        <NamedIcon name="search" />
      </Link>
    </>
  );
}
