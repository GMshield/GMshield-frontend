'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';

import type { TurnTier } from '@/client/conversation';
import { errorText, translator, type Language } from '@/messages';
import type { Paging } from '@/paging';

import { Pager } from '../Pager';
import { PillButton, SolidPillButton } from '../PillButton';
import formStyles from '../SystemForm.module.css';
import { TierLabel } from '../TierLabel';
import styles from './OverridePicker.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** How long the name filter waits after the last key before it asks again. */
const FILTER_DELAY_MS = 250;

/**
 * A record the picker lists: its id, name and the name of the material it was read from (or, Story 5.5 part B, the
 * word for another artifact), and in the related mode its tier, shown as the tier's pill before its name.
 */
export type OverrideTargetRow = {
  readonly id: string;
  readonly name: string;
  readonly materialName: string;
  readonly tier?: TurnTier;
};

/** A record the picker lists, in either mode (Story 5.5 part B). */
export type RecordPickerRow = OverrideTargetRow;

/** A page the picker read: its rows and where it stands, or the refusal's text. */
export type OverrideTargetsPage =
  | { readonly ok: true; readonly rows: readonly OverrideTargetRow[]; readonly paging: Paging }
  | { readonly ok: false; readonly error: string };

/** How the picker reads a page: the campaign, the record type's key, the name filter and the page (from 1). */
export type LoadOverrideTargets = (campaignId: string, recordType: string, query: string, page: number) => Promise<OverrideTargetsPage>;

/** How the picker reads a page, in either mode (Story 5.5 part B). */
export type LoadRecords = LoadOverrideTargets;

export type OverridePickerTexts = {
  readonly title: string;
  readonly intro: string;
  readonly type: string;
  readonly filter: string;
  readonly list: string;
  readonly empty: string;
  readonly emptyFiltered: string;
  readonly loading: string;
  readonly pages: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly pick: string;
};

/** The picker's texts, in either mode (Story 5.5 part B). */
export type RecordPickerTexts = OverridePickerTexts;

export type OverridePickerProps = {
  readonly open: boolean;
  readonly campaignId: string;
  /** The record types of the campaign's system, in its order, as the page names them. */
  readonly types: readonly { readonly key: string; readonly label: string }[];
  /** The type chosen when it opens: the artifact's own. */
  readonly defaultType: string;
  readonly texts: OverridePickerTexts;
  readonly language: Language;
  readonly load: LoadOverrideTargets;
  /** Whether the choice is being stored: the confirming button shows it is busy and is pressed no more. */
  readonly pending?: boolean;
  /** The refusal of the last confirmation, said under the list; null for none. */
  readonly error?: string | null;
  readonly onConfirm: (recordId: string) => void;
  /** Called by "Cancelar" and by Esc. */
  readonly onCancel: () => void;
};

/** The last page read, and what it was asked for (type, filter and page as one key). */
type Shown = { readonly key: string; readonly page: OverrideTargetsPage | null };

/** The record picker's props, in either mode (Story 5.5 part B). */
export type RecordPickerProps = OverridePickerProps;

/**
 * The dialog that picks a record for an artifact (Story 5.5): the record it overrides (part A, "Substituir um registro")
 * or, in the related mode (part B, "Relacionar um registro"), a record it is related to; only the texts, the loader and
 * the rows' tier pills differ. It opens as the confirmation dialog opens: modal on
 * a dimmed canvas, Tab kept inside, Esc closing it and focus given back to what opened it ("Substituir um registro").
 * It opens with focus on the name filter. A record-type select (the artifact's type at first), then the bordered name
 * filter (case and accents ignored, asked again a moment after the last key), then the records of that type the loader
 * gives (part A: the system tier of the campaign's scope; part B: every tier and the campaign's other artifacts),
 * alphabetical, a page at a time: each a bordered row with its radio, its tier's pill when it has one, its name and
 * its material, every row reachable by Tab, and the pager's buttons ({@link Pager} `onPage`) under them. The confirming
 * button sends the record picked; with none picked it says to pick one. Its choices start afresh each time it is
 * mounted: the caller gives it a new `key` for each opening.
 */
export function RecordPicker({
  open,
  campaignId,
  types,
  defaultType,
  texts,
  language,
  load,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: OverridePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const asked = useRef(0);
  const titleId = useId();
  const introId = useId();
  const listId = useId();
  const typeId = useId();
  const filterId = useId();
  const [recordType, setRecordType] = useState(defaultType);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const [unpicked, setUnpicked] = useState(false);
  const [shown, setShown] = useState<Shown>({ key: '', page: null });
  // Still loading while the page shown was asked for other choices than the current ones.
  const key = JSON.stringify([recordType, filter, page]);
  const loading = shown.key !== key;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      filterRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus(openerRef);
    }
  }, [open]);

  // Unmounted while open: focus still goes back to the opener.
  useEffect(() => () => returnFocus(openerRef), []);

  // The name filter is asked a moment after the last key, from its first page.
  /** Lists another page, filter or type: a pick the GM no longer sees goes. */
  function show(next: { readonly filter?: string; readonly page: number }) {
    if (next.filter !== undefined) {
      setFilter(next.filter);
    }
    setPage(next.page);
    setPicked(null);
    setUnpicked(false);
  }

  useEffect(() => {
    if (query === filter) {
      return;
    }
    const timer = setTimeout(() => show({ filter: query, page: 1 }), FILTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, filter]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const number = asked.current + 1;
    asked.current = number;
    const askedFor = JSON.stringify([recordType, filter, page]);
    load(campaignId, recordType, filter, page).then(
      (read) => {
        if (asked.current === number) {
          setShown({ key: askedFor, page: read });
        }
      },
      () => {
        if (asked.current === number) {
          // A failed read says so in the alert, never "Carregando…" for ever.
          setShown({ key: askedFor, page: { ok: false, error: errorText(null, language) } });
        }
      },
    );
  }, [open, campaignId, recordType, filter, page, load, language]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event);
    }
  }

  function onNativeCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onCancel();
  }

  function confirm() {
    if (pending) {
      return;
    }
    if (picked === null) {
      setUnpicked(true);
      return;
    }
    onConfirm(picked);
  }

  const read = shown.page;
  const rows = read?.ok === true ? read.rows : [];
  const t = translator(language);
  const message = read !== null && !read.ok ? read.error : unpicked && picked === null ? texts.pick : error;
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={introId}
      onKeyDown={onKeyDown}
      onCancel={onNativeCancel}
    >
      <h2 id={titleId} className={styles.title}>
        {texts.title}
      </h2>
      <p id={introId} className={styles.intro}>
        {texts.intro}
      </p>
      <div className={styles.filters}>
        <label className={formStyles.field} htmlFor={typeId}>
          <span className={formStyles.label}>{texts.type}</span>
          <select
            id={typeId}
            className={formStyles.select}
            value={recordType}
            onChange={(event) => {
              setRecordType(event.target.value);
              show({ page: 1 });
            }}
          >
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label className={formStyles.field} htmlFor={filterId}>
          <span className={formStyles.label}>{texts.filter}</span>
          <input
            ref={filterRef}
            id={filterId}
            className={formStyles.input}
            type="search"
            value={query}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter asks at once, and never closes or submits anything.
              if (event.key === 'Enter') {
                event.preventDefault();
                show({ filter: query, page: 1 });
              }
            }}
          />
        </label>
      </div>
      <fieldset className={styles.records} aria-busy={loading || undefined}>
        <legend id={listId} className={styles.legend}>
          {texts.list}
        </legend>
        {read !== null && !read.ok && !loading ? null : rows.length === 0 ? (
          <p className={styles.none} role="status">
            {loading || read === null ? texts.loading : filter.trim() === '' ? texts.empty : texts.emptyFiltered}
          </p>
        ) : (
          <ul className={styles.rows} role="radiogroup" aria-labelledby={listId}>
            {rows.map((row) => (
              <li key={row.id} className={styles.row}>
                <label className={styles.choice}>
                  {/* Each radio has no shared name, so every row is a Tab stop; picking one unpicks the others. */}
                  <input
                    type="radio"
                    value={row.id}
                    checked={picked === row.id}
                    onChange={() => {
                      setPicked(row.id);
                      setUnpicked(false);
                    }}
                  />
                  {row.tier === undefined ? null : <TierLabel tier={row.tier} t={t} />}
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.material}>{row.materialName}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {read?.ok === true ? <Pager compact paging={read.paging} onPage={(next) => show({ page: next })} language={language} label={texts.pages} /> : null}
      </fieldset>
      {message === null ? null : (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      <div className={styles.actions}>
        <PillButton onClick={onCancel}>{texts.cancel}</PillButton>
        <SolidPillButton aria-disabled={pending || undefined} pending={pending} onClick={confirm}>
          {texts.confirm}
        </SolidPillButton>
      </div>
    </dialog>
  );
}

/** The picker of the record an artifact overrides (Story 5.5 part A): the {@link RecordPicker}. */
export const OverridePicker = RecordPicker;

function returnFocus(openerRef: { current: HTMLElement | null }) {
  const opener = openerRef.current;
  openerRef.current = null;
  if (opener?.isConnected) {
    opener.focus();
  }
}

function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !(active instanceof Node) || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
