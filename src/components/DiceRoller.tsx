'use client';

import { useId, useState, type FormEvent } from 'react';

import { clearRolls, readRolls, ROLL_LOG_PAGE, sendRoll, type RollPage } from '@/client/rolls';
import { DICE, parseFormula, roll, rollSentence, singleDie, type Formula, type Roll } from '@/dice';
import type { Language } from '@/messages';

import styles from './DiceRoller.module.css';
import { useNotifications } from './notifications/NotificationsProvider';
import { Card } from './PageHeader';
import { PillButton } from './PillButton';
import { RollLog, type LogEntry, type RollLogLabels } from './RollLog';

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
  /** The newest stored rolls, read with the page (Story 6.4); null when they could not be read. */
  readonly firstPage: RollPage | null;
};

/** How many rolls the log shows at first, and how many more each "Mostrar mais" shows. */
const LOG_PAGE = ROLL_LOG_PAGE;
/** The longest label (the backend's limit). */
const LABEL_MAX = 80;

type Log = {
  /** Newest first: the stored rolls read so far and this visit's rolls, each once by its key. */
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
 * this site's relay ({@link sendRoll}), never a Server Action. Until the backend confirms it, it reads "ainda não salva";
 * a refusal or no answer makes it "não foi possível salvar" with a remove control (part A keeps it in memory only). The
 * log ({@link RollLog}) starts from the newest stored rolls read with the page; when they could not be read it says so,
 * and the roller still works.
 */
export function DiceRoller({ labels, language, campaignId, shieldId, firstPage }: DiceRollerProps) {
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

  function settle(key: string, saved: boolean, created: boolean) {
    setLog((previous) => {
      if (!previous.entries.some((entry) => entry.key === key)) {
        // Cleared or removed meanwhile: nothing left to mark.
        return previous;
      }
      return {
        ...previous,
        stored: previous.stored + (saved && created ? 1 : 0),
        entries: previous.entries.map((entry) => (entry.key === key ? { ...entry, state: saved ? 'saved' : 'failed' } : entry)),
      };
    });
  }

  function rollFormula(formula: Formula) {
    const next = roll(formula);
    setLatest((previous) => ({ roll: next, count: (previous?.count ?? 0) + 1 }));
    const key = globalThis.crypto.randomUUID();
    const rolledAt = new Date().toISOString();
    const trimmed = label.trim();
    const entry: LogEntry = {
      key,
      formula: next.formula,
      results: [...next.results],
      total: next.total,
      label: trimmed === '' ? null : trimmed,
      rolledAt,
      state: 'pending',
    };
    setLabel('');
    setLog((previous) => ({ ...previous, entries: [entry, ...previous.entries] }));
    void sendRoll(campaignId, shieldId, {
      key,
      formula: next.formula,
      results: [...next.results],
      ...(entry.label === null ? {} : { label: entry.label }),
      rolledAt,
    }).then((result) => settle(key, result.ok, result.ok && result.created));
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
    if (log.entries.length >= log.shown + LOG_PAGE || log.cursor === undefined) {
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
    setClearing(true);
    const cleared = await clearRolls(campaignId, shieldId);
    setClearing(false);
    if (cleared.ok) {
      setLog(EMPTY_LOG);
      setMoreFailed(false);
      notify({ status: 'success', message: labels.cleared });
    } else {
      notify({ status: 'danger', message: labels.clearFailed });
    }
  }

  const unconfirmed = log.entries.filter((entry) => entry.state !== 'saved').length;
  // A roll still on its way could be stored after the clear and leave the screen: no clear until each one is answered.
  const sending = log.entries.some((entry) => entry.state === 'pending');
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
        entries={log.entries.slice(0, log.shown)}
        more={log.entries.length > log.shown || log.cursor !== undefined}
        loading={loading}
        loadFailed={loadFailed}
        moreFailed={moreFailed}
        count={loadFailed ? null : log.stored + unconfirmed}
        clearing={clearing}
        sending={sending}
        onMore={() => void showMore()}
        onRemove={(key) => setLog((previous) => ({ ...previous, entries: previous.entries.filter((entry) => entry.key !== key) }))}
        onClear={() => void clear()}
      />
    </Card>
  );
}
