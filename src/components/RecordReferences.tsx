'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { translator, type Language, type Translate } from '@/messages';
import type { RecordReference } from '@/server/library';

import styles from './RecordReferences.module.css';
import { ShellPanel } from './ShellPanel';
import { SourceView, type LoadRecordPage } from './SourceView';

/** One reference as one line: the material's name, the section path joined with " › ", and "p. N". */
export function recordReferenceLine(reference: RecordReference, t: Translate): string {
  const parts = [reference.materialName];
  if (reference.sectionPath.length > 0) {
    parts.push(reference.sectionPath.join(' › '));
  }
  parts.push(t('conversation.page', { page: reference.page }));
  return parts.join(', ');
}

export type RecordReferencesProps = {
  /** The system whose record this is: the ground the pages are read on is the record as this system shows it. */
  readonly systemId: string;
  readonly recordId: string;
  /** One per distinct version, section path and page, in page order, as the backend sent them. */
  readonly references: readonly RecordReference[];
  readonly language: Language;
  /** For tests: how a page is read (the relay's fetcher by default). */
  readonly loadRecord?: LoadRecordPage;
};

/**
 * A record's source references (Story 4.3), under its fields: a heading, then one line per reference in label type, as
 * an answer's references read. Each line is a button, named by its line, that opens the source view at that page of
 * the record's version, in the shell's right panel, on the record's ground, with the record's passages on that page
 * marked as an answer's cited passages are; the view turns to the version's other pages from there. Esc or the close control closes it, and focus goes back to the line that opened it. A click or
 * Enter on a focused line opens it.
 */
export function RecordReferences({ systemId, recordId, references, language, loadRecord }: RecordReferencesProps) {
  const t = translator(language);
  const headingId = useId();
  const [open, setOpen] = useState<{ readonly index: number; readonly opened: number } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focusOpener = useRef(false);
  const openings = useRef(0);

  // The source view closed: focus goes back to the line that opened it.
  useEffect(() => {
    if (open !== null || !focusOpener.current) {
      return;
    }
    focusOpener.current = false;
    const line = opener.current;
    opener.current = null;
    if (line?.isConnected) {
      line.focus();
    }
  }, [open]);

  const shown = open === null ? undefined : references[open.index];
  return (
    <section className={styles.references} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t('systems.records.references')}
      </h2>
      <ul className={styles.list}>
        {references.map((reference, index) => (
          <li key={`${reference.versionId}:${reference.page}:${reference.sectionPath.join('\u0000')}`}>
            <button
              type="button"
              className={styles.reference}
              aria-haspopup="dialog"
              data-open={open?.index === index ? 'true' : undefined}
              onClick={(event) => {
                opener.current = event.currentTarget;
                openings.current += 1;
                setOpen({ index, opened: openings.current });
              }}
            >
              {recordReferenceLine(reference, t)}
            </button>
          </li>
        ))}
      </ul>
      {open === null || shown === undefined ? null : (
        <ShellPanel onReplaced={() => setOpen(null)}>
          <SourceView
            key={`${open.index}:${open.opened}`}
            ground={{ kind: 'record', systemId, recordId }}
            reference={{ materialName: shown.materialName, sectionPath: shown.sectionPath, page: shown.page, passageIds: shown.passageIds }}
            language={language}
            loadRecord={loadRecord}
            onClose={() => {
              focusOpener.current = true;
              setOpen(null);
            }}
          />
        </ShellPanel>
      )}
    </section>
  );
}
