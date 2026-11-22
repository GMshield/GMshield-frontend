'use client';

import { useId } from 'react';

import styles from './Switch.module.css';

export type SwitchProps = {
  /** What it turns on and off, shown and spoken as its name ("Campanha", a material's name). */
  readonly label: string;
  readonly checked: boolean;
  /** Its state in words: "ligado" and "desligado". */
  readonly states: { readonly on: string; readonly off: string };
  /** Called with the new state on a press; never while it is disabled. */
  readonly onChange: (checked: boolean) => void;
  /** Disabled: it stays focusable and says so (`aria-disabled`), and a press does nothing. */
  readonly disabled?: boolean;
  /** The id of a line that says more about it (why it is disabled), read after its state. */
  readonly describedBy?: string;
};

/**
 * A switch (Story 3.6): a button with `role="switch"` and `aria-checked`, its name, its state in words and a track with
 * a knob. Its name stays the same whatever the state; the state word is shown beside the track and read as its
 * description, so a screen reader hears "Campanha, ligado". On, the track takes the solid pair (the text colour and
 * the canvas), never the accent. The whole row is the hit area, at least 44px high. A disabled switch keeps its focus
 * (a pending save must not throw the keyboard back to the top of the page) and ignores presses.
 */
export function Switch({ label, checked, states, onChange, disabled = false, describedBy }: SwitchProps) {
  const stateId = useId();
  return (
    <button
      type="button"
      role="switch"
      className={styles.switch}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy === undefined ? stateId : `${stateId} ${describedBy}`}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
    >
      <span className={styles.label}>{label}</span>
      <span id={stateId} className={styles.state}>
        {checked ? states.on : states.off}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}
