'use client';

import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from 'react';

import {
  addPending,
  dropShield,
  flush,
  noPending,
  onOutcome,
  pendingFor,
  removeRoll,
  restoreRolls,
  sendingFor,
  subscribe,
  type PendingRoll,
} from '@/client/pending-rolls';
import { clearRolls, readRolls, ROLL_LOG_PAGE, type RollPage } from '@/client/rolls';
import { DICE, parseFormula, roll, rollSentence, singleDie, type Formula, type Roll } from '@/dice';
import type { Language } from '@/messages';

import styles from './DiceRoller.module.css';
import { useNotifications } from './notifications/NotificationsProvider';
import { Card } from './PageHeader';
import { PillButton } from './PillButton';
import { RollLog, type LogEntry, type RollLogLabels } from './RollLog';
import { useOnline } from './useOnline';

export type DiceRollerLabels = RollLogLabels & {
  /** The card's heading ("Dados"). */
  readonly title: string;
  /** The formula field's label ("Fórmula"). */
  readonly formula: string;
  /** The formula's submit pill ("Rolar"). */
  readonly roll: string;
  /** Under the field when the formula does not read ("Use o formato 2d6+3."). */
  readonly invalid: string;
  /** The spoken roll, with `{formula}`, `{dice}` and `{total}` ("{formula}: {dice}, total {total}"). */
  readonly sentence: string;
  /** The spoken name of the row of die buttons ("Rolar um dado"). */
  readonly die: string;
  /** The optional label field's label ("Rótulo", Story 6.4). */
  readonly label: string;
  /** The toast once the rolls are cleared ("Rolagens limpas."). */
  readonly cleared: string;
  /** The toast when they could not be. */
  readonly clearFailed: string;
};

export type DiceRollerProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: DiceRollerLabels;
  readonly language: Language;
  readonly campaignId: string;
  readonly shieldId: string;
  /**
   * The signed-in account's id, which keys this browser's pending rolls (Story 6.4 part B); null when it could not be
   * read, and the rolls not saved yet then live as long as the tab.
   */
  readonly accountId: string | null;
  /** The newest stored rolls, read with the page (Story 6.4); null when they could not be read. */
  readonly firstPage: RollPage | null;
};

/** How many rolls the log shows at first, and how many more each "Mostrar mais" shows. */
const LOG_PAGE = ROLL_LOG_PAGE;
/** The longest label (the backend's limit). */
const LABEL_MAX = 80;

type Log = {
  /** Newest first: the stored rolls read so far and the ones saved during this visit, each once by its key. */
  readonly entries: readonly LogEntry[];
  /** The cursor of the next stored page; undefined once the oldest is read. */
  readonly cursor: string | undefined;
  /** How many rolls the backend holds, as far as this page knows. */
  readonly stored: number;
  /** How many entries show. */
  readonly shown: number;
};

const EMPTY_LOG: Log = { entries: [], cursor: undefined, stored: 0, shown: LOG_PAGE };

function logOf(page: RollPage | null): Log {
  if (page === null) {
    return EMPTY_LOG;
  }
  return {
    entries: page.items.map((item) => ({ ...item, state: 'saved' as const })),
    cursor: page.nextCursor,
    stored: page.total,
    shown: LOG_PAGE,
  };
}

/** Newest first by time; equal times keep their order (the backend's, by id). */
function newestFirst(entries: readonly LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.rolledAt) - Date.parse(a.rolledAt));
}

function entryOf(roll: PendingRoll, state: LogEntry['state']): LogEntry {
  return {
    key: roll.key,
    formula: roll.formula,
    results: [...roll.results],
    total: roll.total,
    label: roll.label,
    rolledAt: roll.rolledAt,
    state,
  };
}

/**
 * The log's lines: the saved ones and this browser's pending and refused rolls of the Shield; each key once (saved first,
 * then the stored list's), newest first.
 */
function merged(saved: readonly LogEntry[], pending: readonly PendingRoll[]): LogEntry[] {
  const known = new Set(saved.map((entry) => entry.key));
  const waiting: LogEntry[] = [];
  for (const roll of pending) {
    if (!known.has(roll.key)) {
      known.add(roll.key);
      waiting.push(entryOf(roll, roll.state === 'pending' ? 'pending' : 'failed'));
    }
  }
  return waiting.length === 0 ? [...saved] : newestFirst([...waiting, ...saved]);
}

/**
 * The Shield's dice roller (Story 6.3), the only part of GMshield that works offline: a row of 44px die buttons (d4 to
 * d100, each rolling one die of its kind), then the bordered "Fórmula" field with the optional "Rótulo" beside it and the
 * outlined "Rolar" pill (Enter submits; the screen's one solid pill stays the header's "Nova nota").
 * Every die is drawn in the browser from `crypto.getRandomValues` ({@link roll}), so once the screen has loaded a roll
 * needs no connection. The latest roll shows at once: the total in the title type, the dice beside it in muted text. A
 * polite live region says it as one sentence, again for an identical roll (its text is a new node each time). A formula
 * that does not read keeps its text, is marked invalid with "Use o formato 2d6+3." under it, rolls nothing and leaves the
 * last result; the message clears when the text changes or a die button rolls.
 *
 * Story 6.4 part A: every roll gets a key from `crypto.randomUUID()`, shows in the log at once with its time and label
 * (the label applies to that roll only, from a die button or the formula, and empties after it), and is sent through
 * this site's relay, never a Server Action. The log ({@link RollLog}) starts from the newest stored rolls read with the page;
 * when they could not be read it says so, and the roller still works.
 *
 * Story 6.4 part B (AD-31): a new roll is first kept in this browser's pending list ({@link addPending}, under the account
 * and the Shield), then sent by the one sender ({@link flush}), which also sends the waiting rolls when the screen opens
 * and when the connection returns. The log merges the stored rolls with this browser's pending and refused rolls of the
 * Shield, each once by its key. Until the backend confirms a roll it reads "ainda não salva" (also offline, or with no
 * answer); a refusal (400, 404 or 409) makes it "não foi possível salvar" with a remove control, which deletes it from the
 * list; nothing else removes it. The marks follow the sender's results, from
 * this screen or from the layout's sync, with no reload; another tab's changes show through the `storage` event. While
 * the browser is offline a line above the log says the rolls will be saved when the connection returns. "Limpar
 * rolagens" waits while a roll of the Shield is on its way in this tab (confirming checks again); confirming drops the
 * Shield's pending and refused rolls from the list first, then clears the stored ones, and puts them back when the clear
 * fails.
 */
export function DiceRoller({ labels, language, campaignId, shieldId, accountId, firstPage }: DiceRollerProps) {
  const base = useId();
  const fieldId = `${base}-formula`;
  const labelId = `${base}-label`;
  const errorId = `${base}-formula-error`;
  const headingId = `${base}-title`;
  const { notify } = useNotifications();
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [latest, setLatest] = useState<{ readonly roll: Roll; readonly count: number } | null>(null);
  const [log, setLog] = useState<Log>(() => logOf(firstPage));
  // Whether the stored rolls could not be read when the log started: the log keeps that start across a `?page=` of the
  // notes, so this does too.
  const [loadFailed] = useState(() => firstPage === null);
  const [loading, setLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const online = useOnline();
  const pending = useSyncExternalStore(subscribe, () => pendingFor(accountId, shieldId), noPending);
  const inFlight = useSyncExternalStore(subscribe, () => sendingFor(accountId, shieldId), () => false);

  useEffect(() => {
    const stop = onOutcome((outcome) => {
      if (outcome.accountId !== accountId || outcome.shieldId !== shieldId) {
        return;
      }
      const entry: LogEntry = outcome.stored === null ? entryOf(outcome.roll, 'saved') : { ...outcome.stored, state: 'saved' };
      setLog((previous) =>
        previous.entries.some((kept) => kept.key === entry.key)
          ? previous
          : {
              ...previous,
              stored: previous.stored + (outcome.created ? 1 : 0),
              entries: newestFirst([entry, ...previous.entries]),
            },
      );
    });
    // The screen opens: send what waits; and again whenever the connection returns.
    const send = () => void flush(accountId);
    send();
    window.addEventListener('online', send);
    return () => {
      stop();
      window.removeEventListener('online', send);
    };
  }, [accountId, shieldId]);

  // The log's lines: the stored and saved rolls with this browser's waiting ones; the ones not saved count in a clear.
  const entries = merged(log.entries, pending);
  const unconfirmed = entries.length - log.entries.length;
  // A roll still on its way could be stored after the clear and leave the screen: no clear until each one is answered.
  const sending = inFlight;

  function rollFormula(formula: Formula) {
    const next = roll(formula);
    setLatest((previous) => ({ roll: next, count: (previous?.count ?? 0) + 1 }));
    const key = globalThis.crypto.randomUUID();
    const rolledAt = new Date().toISOString();
    const trimmed = label.trim();
    setLabel('');
    addPending(accountId, shieldId, {
      key,
      campaignId,
      formula: next.formula,
      results: [...next.results],
      total: next.total,
      label: trimmed === '' ? null : trimmed,
      rolledAt,
    });
    void flush(accountId);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formula = parseFormula(text);
    if (formula === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    rollFormula(formula);
  }

  async function showMore() {
    if (loading) {
      return;
    }
    setMoreFailed(false);
    if (entries.length >= log.shown + LOG_PAGE || log.cursor === undefined) {
      setLog((previous) => ({ ...previous, shown: previous.shown + LOG_PAGE }));
      return;
    }
    setLoading(true);
    const read = await readRolls(campaignId, shieldId, LOG_PAGE, log.cursor);
    setLoading(false);
    if (!read.ok) {
      setMoreFailed(true);
      return;
    }
    setLog((previous) => {
      const known = new Set(previous.entries.map((entry) => entry.key));
      const older = read.page.items.filter((item) => !known.has(item.key)).map((item) => ({ ...item, state: 'saved' as const }));
      return {
        entries: newestFirst([...previous.entries, ...older]),
        cursor: read.page.nextCursor,
        stored: read.page.total,
        shown: previous.shown + LOG_PAGE,
      };
    });
  }

  async function clear() {
    // A send that started after the dialog opened (the connection came back) would race the DELETE: no clear then.
    if (sendingFor(accountId, shieldId)) {
      return;
    }
    // This browser's pending and refused rolls of the Shield go first, so this tab sends none of them after the clear
    // (another tab may still be sending one; it would then be stored after the clear).
    const dropped = dropShield(accountId, shieldId);
    setClearing(true);
    const cleared = await clearRolls(campaignId, shieldId);
    setClearing(false);
    if (cleared.ok) {
      setLog(EMPTY_LOG);
      setMoreFailed(false);
      notify({ status: 'success', message: labels.cleared });
    } else {
      // Nothing was cleared: the waiting rolls go back, each as it was, to be sent later.
      restoreRolls(accountId, shieldId, dropped);
      notify({ status: 'danger', message: labels.clearFailed });
    }
  }

  return (
    <Card heading={labels.title} headingId={headingId}>
      <div className={styles.dice} role="group" aria-label={labels.die}>
        {DICE.map((sides) => (
          <button
            key={sides}
            type="button"
            className={styles.die}
            onClick={() => {
              setInvalid(false);
              rollFormula(singleDie(sides));
            }}
          >
            d{sides}
          </button>
        ))}
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={fieldId} className={styles.label}>
              {labels.formula}
            </label>
            <input
              id={fieldId}
              className={styles.input}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
              placeholder="2d6+3"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={labelId} className={styles.label}>
              {labels.label}
            </label>
            <input
              id={labelId}
              className={styles.input}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={LABEL_MAX}
              autoComplete="off"
              enterKeyHint="go"
            />
          </div>
          <PillButton type="submit" className={styles.submit}>
            {labels.roll}
          </PillButton>
        </div>
        {invalid ? (
          <p id={errorId} role="alert" className={styles.error}>
            {labels.invalid}
          </p>
        ) : null}
      </form>
      {latest === null ? null : (
        <p className={styles.result} data-testid="dice-result">
          <span className={styles.formula}>{latest.roll.formula}</span>
          <span className={styles.total}>{latest.roll.total}</span>
          <span className={styles.results}>{latest.roll.results.join(', ')}</span>
        </p>
      )}
      <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
        {/* Keyed by the roll's count: an identical roll is a new node, so it is announced again. */}
        {latest === null ? null : <span key={latest.count}>{rollSentence(latest.roll, labels.sentence)}</span>}
      </div>
      <RollLog
        labels={labels}
        language={language}
        entries={entries.slice(0, log.shown)}
        more={entries.length > log.shown || log.cursor !== undefined}
        offline={!online}
        loading={loading}
        loadFailed={loadFailed}
        moreFailed={moreFailed}
        count={loadFailed ? null : log.stored + unconfirmed}
        clearing={clearing}
        sending={sending}
        onMore={() => void showMore()}
        onRemove={(key) => removeRoll(accountId, shieldId, key)}
        onClear={() => void clear()}
      />
    </Card>
  );
}
