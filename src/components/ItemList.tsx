'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import styles from './ItemList.module.css';
import { PillButton } from './PillButton';
import { StatePill, type PillState } from './StatePill';

/** One row of a list (Story 3.1): its text, an optional muted detail, the page it opens, and a material's state. */
export type ListRow = {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly href: string | null;
  readonly state: { readonly state: PillState; readonly word: string } | null;
};

/**
 * The rows "Carregar mais" added, the cursor of the next page (null on the last), a refusal's text, and how many rows
 * the last page added (announced).
 */
export type MoreState = {
  readonly rows: readonly ListRow[];
  readonly nextCursor: string | null;
  readonly error: string | null;
  readonly added: number;
};

export type ItemListProps = {
  /** The list's accessible name. */
  readonly label: string;
  /** The first page, read by the server. */
  readonly rows: readonly ListRow[];
  /** The cursor of the next page; null when the first page is the last. */
  readonly nextCursor: string | null;
  /** "Carregar mais", in the interface's language. */
  readonly loadMore: string;
  /** What is announced once a page is added, for one row and for `{count}` rows, in the interface's language. */
  readonly added: { readonly one: string; readonly other: string };
  /** The Server Action that reads the next page. */
  readonly action: (previous: MoreState, form: FormData) => Promise<MoreState>;
  /** Fields the action needs besides the cursor, such as the system's id. */
  readonly fields?: Readonly<Record<string, string>>;
};

/**
 * A list page's rows (Story 3.1): each row opens its page when it has one, with a muted detail (a system's edition) or
 * a material's state pill. While there is a next page, a "Carregar mais" pill under the list adds it on request,
 * never on scrolling; it posts the cursor to a Server Action, so it works without JavaScript too. A polite status,
 * not shown, says how many rows the page added. A refusal shows as an alert under the list, and the rows already there
 * stay.
 */
export function ItemList({ label, rows, nextCursor, loadMore, added, action, fields = {} }: ItemListProps) {
  const [state, formAction, pending] = useActionState(action, { rows: [], nextCursor, error: null, added: 0 });
  let announcement = '';
  if (state.added === 1) {
    announcement = added.one;
  } else if (state.added > 1) {
    announcement = added.other.replace('{count}', String(state.added));
  }
  const shown = [...rows, ...state.rows];
  return (
    <>
      <ul className={styles.list} aria-label={label}>
        {shown.map((row) => {
          const content = (
            <>
              <span className={styles.label}>{row.label}</span>
              {row.detail === null ? null : <span className={styles.detail}>{row.detail}</span>}
              {row.state === null ? null : <StatePill state={row.state.state} word={row.state.word} />}
            </>
          );
          return (
            <li key={row.id}>
              {row.href === null ? (
                <span className={styles.row}>{content}</span>
              ) : (
                <Link className={`${styles.row} ${styles.link}`} href={row.href}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {state.nextCursor === null ? null : (
        <form action={formAction} className={styles.more}>
          <input type="hidden" name="cursor" value={state.nextCursor} />
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <PillButton type="submit" disabled={pending}>
            {loadMore}
          </PillButton>
        </form>
      )}
      <p role="status" className={styles.hidden}>
        {announcement}
      </p>
      {state.error === null ? null : (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
    </>
  );
}
