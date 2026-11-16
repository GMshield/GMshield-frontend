import Link from 'next/link';

import styles from './ContextBar.module.css';

export type ContextBarProps = {
  /** Its spoken name, "Sistema e campanha". */
  readonly label: string;
  /** The current campaign and its system, or none (the words for none are shown instead). */
  readonly current: { readonly system: string; readonly campaign: string } | null;
  readonly none: string;
};

/**
 * One line above the main column: "system › campaign" in the label style and the muted colour; under 768px the
 * campaign name only. The names lead to Sistemas and Minhas Mesas until the campaign switcher (Epic 3).
 */
export function ContextBar({ label, current, none }: ContextBarProps) {
  return (
    <nav className={styles.bar} aria-label={label}>
      {current === null ? (
        <span className={styles.none}>{none}</span>
      ) : (
        <>
          <Link className={`${styles.link} ${styles.system}`} href="/systems">
            {current.system}
          </Link>
          <span className={styles.separator} aria-hidden="true">
            ›
          </span>
          <Link className={styles.link} href="/campaigns">
            {current.campaign}
          </Link>
        </>
      )}
    </nav>
  );
}
