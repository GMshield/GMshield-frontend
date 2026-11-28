'use client';

import { useId, useState, useSyncExternalStore } from 'react';

import type { StoredRoll } from '@/client/rolls';
import type { Language } from '@/messages';

import { ConfirmationDialog } from './ConfirmationDialog';
import { CloseIcon } from './Icons';
import { PillButton } from './PillButton';
import styles from './RollLog.module.css';

export type RollLogLabels = {
  /** The log's heading ("Rolagens"). */
  readonly log: string;
  /** An empty log ("Nenhuma rolagem ainda."). */
  readonly empty: string;
  /** A roll the backend has not confirmed yet ("ainda não salva"). */
  readonly unsaved: string;
  /** A roll the backend refused or did not answer ("não foi possível salvar"). */
  readonly failed: string;
  /** The remove control's spoken name, with `{formula}` and `{time}`. */
  readonly remove: string;
  /** "Mostrar mais". */
  readonly more: string;
  /** When the next rolls could not be read. */
  readonly moreFailed: string;
  /** When the stored rolls could not be read with the page. */
  readonly loadFailed: string;
  /** "Limpar rolagens", the pill. */
  readonly clear: string;
  /** The dialog's title, with `{rolls}` ("Limpar 3 rolagens?"). */
  readonly clearTitle: string;
  readonly clearConsequence: string;
  readonly clearConfirm: string;
  /** "1 rolagem". */
  readonly rollsOne: string;
  /** "{count} rolagens". */
  readonly rollsOther: string;
  /** Above the log while the browser is offline ("Sem conexão. As rolagens serão salvas quando ela voltar.", Story 6.4 part B). */
  readonly offline: string;
};

/** A line of the log: a roll as stored (or as made here), and whether the backend has it. */
export type LogEntry = Omit<StoredRoll, 'id'> & { readonly id?: string; readonly state: 'saved' | 'pending' | 'failed' };

export type RollLogProps = {
  readonly labels: RollLogLabels;
  readonly language: Language;
  /** The lines that show, newest first. */
  readonly entries: readonly LogEntry[];
  /** Whether there is more to show ("Mostrar mais"). */
  readonly more: boolean;
  /** Whether the browser is offline: the offline line stands above the log (Story 6.4 part B). */
  readonly offline: boolean;
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly moreFailed: boolean;
  /** How many rolls a clear takes; null when the stored ones are not known (no clear then). */
  readonly count: number | null;
  readonly clearing: boolean;
  /** Whether a roll of the Shield is being sent: "Limpar rolagens" opens nothing until it is answered. */
  readonly sending: boolean;
  readonly onMore: () => void;
  readonly onRemove: (key: string) => void;
  readonly onClear: () => void;
};

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/** The time as the GM reads it: hour and minute, with the day and month when it is not today. */
export function rollTime(rolledAt: string, language: Language, now: Date = new Date()): string {
  const date = new Date(rolledAt);
  const today = now.toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    language,
    today ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
  ).format(date);
}

const subscribeNothing = () => () => undefined;

/**
 * The Shield's roll log (Story 6.4 part A), under the latest result: its newest 10 rolls, "Mostrar mais" for 10 more,
 * each line its time (hour:minute, with the day and month when the roll is not from today), its label, its formula, its
 * dice and its total. A roll not confirmed yet reads "ainda não salva"; a refused one "não foi possível salvar", with a
 * remove control that has a spoken name. An empty log reads "Nenhuma rolagem ainda.". "Limpar rolagens" opens the 440px
 * confirmation, which names the count; while a roll is still being sent it stays focusable but opens nothing
 * (`aria-disabled`), so no roll is stored after the clear and lost from the screen. Story 6.4 part B: a roll that waits in
 * this browser reads "ainda não salva" until it is saved; while the browser is offline, "Sem conexão. As rolagens serão
 * salvas quando ela voltar." stands under the heading, above the lines. Times are the browser's own, so they show once the page runs in it (the server
 * does not know the GM's time zone).
 */
export function RollLog({
  labels,
  language,
  entries,
  more,
  offline,
  loading,
  loadFailed,
  moreFailed,
  count,
  clearing,
  sending,
  onMore,
  onRemove,
  onClear,
}: RollLogProps) {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const rolls = count === 1 ? labels.rollsOne : fill(labels.rollsOther, { count: String(count ?? 0) });
  return (
    <section className={styles.log} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h3 id={headingId} className={styles.heading}>
          {labels.log}
        </h3>
        {count === null || count === 0 ? null : (
          <PillButton
            variant="danger"
            aria-haspopup="dialog"
            aria-disabled={clearing || sending || undefined}
            pending={clearing}
            onClick={() => {
              if (!clearing && !sending) {
                setConfirming(true);
              }
            }}
          >
            {labels.clear}
          </PillButton>
        )}
      </div>
      {offline ? (
        <p className={styles.notice} role="status" data-testid="rolls-offline">
          {labels.offline}
        </p>
      ) : null}
      {loadFailed ? (
        <p className={styles.notice} role="status">
          {labels.loadFailed}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className={styles.empty}>{labels.empty}</p>
      ) : (
        <ol className={styles.list}>
          {entries.map((entry) => {
            const time = inBrowser ? rollTime(entry.rolledAt, language) : '';
            return (
              <li key={entry.key} className={styles.line} data-state={entry.state}>
                <time className={styles.time} dateTime={entry.rolledAt}>
                  {time}
                </time>
                <span className={styles.what}>
                  {entry.label === null ? null : <span className={styles.label}>{entry.label}</span>}
                  <span className={styles.formula}>{entry.formula}</span>
                  <span className={styles.results}>{entry.results.join(', ')}</span>
                </span>
                <span className={styles.total}>{entry.total}</span>
                {entry.state === 'pending' ? (
                  <span className={styles.state}>
                    <span className={styles.mark}>{labels.unsaved}</span>
                  </span>
                ) : null}
                {entry.state === 'failed' ? (
                  <span className={styles.state}>
                    <span className={`${styles.mark} ${styles.failed}`}>{labels.failed}</span>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={fill(labels.remove, { formula: entry.formula, time })}
                      onClick={() => onRemove(entry.key)}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {moreFailed ? (
        <p className={styles.notice} role="alert">
          {labels.moreFailed}
        </p>
      ) : null}
      {more ? (
        <PillButton className={styles.more} aria-disabled={loading || undefined} pending={loading} onClick={onMore}>
          {labels.more}
        </PillButton>
      ) : null}
      {count === null || count === 0 ? null : (
        <ConfirmationDialog
          open={confirming}
          title={fill(labels.clearTitle, { rolls })}
          consequence={labels.clearConsequence}
          confirmLabel={labels.clearConfirm}
          language={language}
          onConfirm={() => {
            setConfirming(false);
            onClear();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
