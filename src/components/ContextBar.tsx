import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './ContextBar.module.css';

export type ContextBarProps = {
  /** Its spoken name, "Sistema e campanha". */
  readonly label: string;
  /** The current campaign and its system, or none (the words for none are shown instead). */
  readonly current: { readonly system: string; readonly campaign: string } | null;
  readonly none: string;
  /** In place of the campaign's name: the campaign switcher (Story 3.2); without it, a link to Minhas Mesas. */
  readonly switcher?: ReactNode;
  /** After the campaign: its scope summary, which opens the scope popover (Story 3.6); none without a campaign. */
  readonly scope?: ReactNode;
};

/**
 * One line above the main column: "system › campaign" in the label style and the muted colour; under 768px the
 * campaign name only. The system's name leads to Sistemas; from Story 3.2 the campaign's name is the campaign switcher,
 * which also opens when there is no campaign. Story 3.6: after the campaign, its scope summary, which opens the scope
 * popover under the bar (the bar is the popover's containing block); with no campaign, or a scope that could not be
 * read, there is none. Under 768px it is not shown either.
 */
export function ContextBar({ label, current, none, switcher, scope }: ContextBarProps) {
  return (
    <nav className={styles.bar} aria-label={label}>
      {current === null ? (
        (switcher ?? <span className={styles.none}>{none}</span>)
      ) : (
        <>
          <Link className={`${styles.link} ${styles.system}`} href="/systems">
            {current.system}
          </Link>
          <span className={styles.separator} aria-hidden="true">
            ›
          </span>
          {switcher ?? (
            <Link className={styles.link} href="/campaigns">
              {current.campaign}
            </Link>
          )}
          {scope}
        </>
      )}
    </nav>
  );
}
