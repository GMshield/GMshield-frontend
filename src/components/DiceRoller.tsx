'use client';

import { useId, useState, type FormEvent } from 'react';

import { DICE, parseFormula, roll, rollSentence, singleDie, type Formula, type Roll } from '@/dice';

import styles from './DiceRoller.module.css';
import { Card } from './PageHeader';
import { PillButton } from './PillButton';

export type DiceRollerLabels = {
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
};

export type DiceRollerProps = {
  /** Every text, in the interface's language (the server translates). */
  readonly labels: DiceRollerLabels;
};

/**
 * The Shield's dice roller (Story 6.3), the only part of GMshield that works offline: a row of 44px die buttons (d4 to
 * d100, each rolling one die of its kind), then the bordered "Fórmula" field and the outlined "Rolar" pill (Enter
 * submits; the screen's one solid pill stays the header's "Nova nota").
 * Every die is drawn in the browser from `crypto.getRandomValues` ({@link roll}); nothing is sent or stored, so once the
 * screen has loaded a roll needs no connection. Only the latest roll shows: the total in the title type, the dice beside
 * it in muted text, at once. A polite live region says it as one sentence, again for an identical roll (its text is a
 * new node each time). A formula that does not read keeps its text, is marked invalid with "Use o formato 2d6+3." under
 * it, rolls nothing and leaves the last result; the message clears when the text changes or a die button rolls. Story
 * 6.4 keeps the rolls.
 */
export function DiceRoller({ labels }: DiceRollerProps) {
  const base = useId();
  const fieldId = `${base}-formula`;
  const errorId = `${base}-formula-error`;
  const headingId = `${base}-title`;
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [latest, setLatest] = useState<{ readonly roll: Roll; readonly count: number } | null>(null);

  function rollFormula(formula: Formula) {
    const next = roll(formula);
    setLatest((previous) => ({ roll: next, count: (previous?.count ?? 0) + 1 }));
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
        <label htmlFor={fieldId} className={styles.label}>
          {labels.formula}
        </label>
        <div className={styles.row}>
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
          <PillButton type="submit">{labels.roll}</PillButton>
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
    </Card>
  );
}
