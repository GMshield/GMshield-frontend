'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import type { Language } from '@/messages';
import type { Paging } from '@/paging';

import { NamedIcon } from './Icons';
import { Pager } from './Pager';
import { PillButton } from './PillButton';
import styles from './ProposalList.module.css';

/** One pending ontology proposal as a row shows it (Story 4.4): read by the server, every word already translated. */
export type ProposalItem = {
  readonly id: string;
  /** The version a decision names. */
  readonly version: number;
  readonly kind: 'record_type' | 'term';
  readonly name: string;
  /** The kind in words ("Tipo de registro", "Termo"). */
  readonly kindLabel: string;
  /** Where it comes from: the material (and, on a material in several systems, the system); null for nothing to say. */
  readonly detail: string | null;
  /** A term's quoted definition, or a record type's when the material gives one; null for none. */
  readonly definition: string | null;
  /** Its examples, each a quote and its page, already in words ("«…», p. 40"). */
  readonly examples: readonly string[];
  /** What it may be merged into: the system's record types (for a type) or terms (for a term). */
  readonly targets: readonly { readonly id: string; readonly label: string }[];
};

export type ProposalTexts = {
  readonly examples: string;
  readonly definition: string;
  readonly approve: string;
  readonly rename: string;
  readonly renameLabel: string;
  readonly approveAs: string;
  readonly merge: string;
  readonly mergeLabel: string;
  readonly mergeInto: string;
  readonly noTargets: string;
  readonly reject: string;
  readonly cancel: string;
  readonly stale: string;
  readonly viewCurrent: string;
  readonly actions: string;
};

/** What a decision answered: a refusal's text, or whether it was stale; `serial` counts the answers. */
export type ProposalDecisionState = { readonly error: string | null; readonly stale: boolean; readonly serial: number };

export const NO_DECISION: ProposalDecisionState = { error: null, stale: false, serial: 0 };

export type ProposalListProps = {
  /** The list's accessible name. */
  readonly label: string;
  readonly items: readonly ProposalItem[];
  readonly texts: ProposalTexts;
  /** The Server Action every decision posts to: the form's `id`, `version`, `decision`, `name` and `target`. */
  readonly action: (previous: ProposalDecisionState, form: FormData) => Promise<ProposalDecisionState>;
  /** Where the rows stand in the whole list, and the list's address; without it the list is not paged. */
  readonly pages?: {
    readonly paging: Paging;
    readonly path: string;
    readonly query?: Readonly<Record<string, string>>;
    /** The query field that carries the page; `page` unless the screen pages two lists. */
    readonly field?: string;
  };
  readonly language: Language;
};

/**
 * A list of pending ontology proposals (Story 4.4), on a system's "Ontologia" tab and on a material's page. A row shows
 * the proposed name (label type), its kind, where it comes from, a term's definition and its examples (muted, each
 * with its page), then four pills: "Aprovar" (as proposed), "Renomear" (an inline bordered field, then "Aprovar como"),
 * "Mesclar" (a select of the system's record types or terms of the same kind, then "Mesclar") and "Rejeitar". Each
 * posts to one Server Action on the version the page read; the action says what it did in a toast and the page is read
 * again, so a decided proposal leaves the list. A refusal stays beside the row's pills; a stale decision (another tab
 * decided it first) says "Este item mudou em outra aba." with "Ver a versão atual", which reads the page again. Every
 * control is a button, a field or a select, so the whole row works from the keyboard; when a decided row leaves the
 * list while it held the focus, the focus goes to the next row's first pill.
 */
export function ProposalList({ label, items, texts, action, pages, language }: ProposalListProps) {
  const list = useRef<HTMLUListElement>(null);
  const ids = items.map((item) => item.id).join(' ');
  const shown = useRef(ids);
  // The position of the row that last held the focus.
  const focused = useRef<number | null>(null);
  useEffect(() => {
    // A decided row left the list with the focus: it goes to the first pill of the row now in its place (the last row
    // when it was the last), rather than to the page's top. The first render takes nobody's focus.
    const lost = document.activeElement === document.body || document.activeElement === null;
    const rows = list.current === null ? [] : Array.from(list.current.children);
    if (shown.current !== ids && lost && focused.current !== null && rows.length > 0) {
      rows[Math.min(focused.current, rows.length - 1)]!.querySelector<HTMLButtonElement>('button')?.focus();
    }
    shown.current = ids;
  }, [ids]);
  return (
    <>
      <ul
        ref={list}
        className={styles.list}
        aria-label={label}
        onFocus={(event) => {
          const row = (event.target as HTMLElement).closest('li');
          const rows = list.current === null ? [] : Array.from(list.current.children);
          const index = row === null ? -1 : rows.indexOf(row);
          if (index >= 0) {
            focused.current = index;
          }
        }}
      >
        {items.map((item) => (
          <ProposalRow key={`${item.id}-${item.version}`} item={item} texts={texts} action={action} />
        ))}
      </ul>
      {pages === undefined ? null : (
        <Pager paging={pages.paging} path={pages.path} query={pages.query} field={pages.field} language={language} />
      )}
    </>
  );
}

type Mode = 'idle' | 'rename' | 'merge';

function ProposalRow({
  item,
  texts,
  action,
}: {
  readonly item: ProposalItem;
  readonly texts: ProposalTexts;
  readonly action: ProposalListProps['action'];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, NO_DECISION);
  const [mode, setMode] = useState<Mode>('idle');
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const errorId = useId();
  useEffect(() => {
    if (mode === 'rename') {
      input.current?.focus();
    } else if (mode === 'merge') {
      select.current?.focus();
    }
  }, [mode]);
  const close = () => {
    setMode('idle');
    // Back to the pill that opened the field, once it is there again.
    queueMicrotask(() => opener.current?.focus());
  };
  const hidden = (
    <>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
    </>
  );
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        <span className={styles.lead} aria-hidden="true">
          <NamedIcon name={item.kind === 'term' ? 'info' : 'rules'} size={22} />
        </span>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.kind}>{item.kindLabel}</span>
        {item.detail === null ? null : <span className={styles.detail}>{item.detail}</span>}
      </div>
      {item.definition === null ? null : (
        <p className={styles.definition}>
          <span className={styles.term}>{texts.definition}</span> {item.definition}
        </p>
      )}
      {item.examples.length === 0 ? null : (
        <ul className={styles.examples} aria-label={texts.examples}>
          {item.examples.map((example, index) => (
            // The same quote may stand on two pages: its position keeps the keys apart.
            <li key={`${index}:${example}`}>{example}</li>
          ))}
        </ul>
      )}
      {mode === 'rename' ? (
        <form className={styles.inline} action={formAction}>
          {hidden}
          <input type="hidden" name="decision" value="rename" />
          <label className={styles.fieldLabel} htmlFor={fieldId}>
            {texts.renameLabel.replace('{name}', item.name)}
          </label>
          <input
            ref={input}
            id={fieldId}
            className={styles.input}
            name="name"
            defaultValue={item.name}
            required
            autoComplete="off"
            aria-invalid={state.error === null ? undefined : true}
            aria-describedby={state.error === null ? undefined : errorId}
          />
          <div className={styles.pills}>
            <PillButton type="submit" variant="solid" pending={pending} disabled={pending}>
              {texts.approveAs}
            </PillButton>
            <PillButton onClick={close}>{texts.cancel}</PillButton>
          </div>
        </form>
      ) : mode === 'merge' ? (
        <form className={styles.inline} action={formAction}>
          {hidden}
          <input type="hidden" name="decision" value="merge" />
          {item.targets.length === 0 ? (
            <p className={styles.note}>{texts.noTargets}</p>
          ) : (
            <label className={styles.fieldLabel} htmlFor={fieldId}>
              {texts.mergeLabel.replace('{name}', item.name)}
            </label>
          )}
          {item.targets.length === 0 ? null : (
            <select ref={select} id={fieldId} className={styles.select} name="target" required>
              {item.targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          )}
          <div className={styles.pills}>
            <PillButton type="submit" variant="solid" pending={pending} disabled={pending || item.targets.length === 0}>
              {texts.mergeInto}
            </PillButton>
            <PillButton onClick={close}>{texts.cancel}</PillButton>
          </div>
        </form>
      ) : (
        <div className={styles.pills} role="group" aria-label={texts.actions.replace('{name}', item.name)}>
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="decision" value="approve" />
            <PillButton type="submit" pending={pending} disabled={pending}>
              {texts.approve}
            </PillButton>
          </form>
          <PillButton
            ref={opener}
            disabled={pending}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setMode('rename');
            }}
          >
            {texts.rename}
          </PillButton>
          <PillButton
            disabled={pending}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setMode('merge');
            }}
          >
            {texts.merge}
          </PillButton>
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="decision" value="reject" />
            <PillButton type="submit" variant="danger" disabled={pending}>
              {texts.reject}
            </PillButton>
          </form>
        </div>
      )}
      {state.stale ? (
        <div role="alert" className={styles.stale}>
          <span>{texts.stale}</span>
          <PillButton variant="quiet" onClick={() => router.refresh()}>
            {texts.viewCurrent}
          </PillButton>
        </div>
      ) : state.error === null ? null : (
        <p id={errorId} role="alert" className={styles.error}>
          {state.error}
        </p>
      )}
    </li>
  );
}
