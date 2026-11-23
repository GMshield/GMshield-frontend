import Link from 'next/link';
import type { ReactNode } from 'react';

import { NamedIcon, type IconName } from './Icons';
import styles from './Page.module.css';

export type PageHeaderProps = {
  /** The page's title, its one `<h1>`. */
  readonly title: string;
  /** The list or the item this page belongs to: a link above the title that leads back to it. */
  readonly back?: { readonly href: string; readonly label: string };
  /** The single main action and the others, on the right of the title. */
  readonly actions?: ReactNode;
  /** Muted lines under the title: what the page is, or a fact about its item. */
  readonly children?: ReactNode;
};

/**
 * The header of every page (usability pass, 2026-11-21): the way back, the title, what the page is, and its actions,
 * always in the same place and the same sizes, so the GM knows where they are and what the page's main action is.
 */
export function PageHeader({ title, back, actions, children }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {back === undefined ? null : (
        <Link className={styles.back} href={back.href}>
          <NamedIcon name="back" size={16} />
          {back.label}
        </Link>
      )}
      <div className={styles.row}>
        <div className={styles.titles}>
          <h1 className={styles.title}>{title}</h1>
          {children}
        </div>
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}

/** A muted line under a page's title. */
export function PageSubtitle({ children }: { readonly children: ReactNode }) {
  return <p className={styles.subtitle}>{children}</p>;
}

export type TabsProps = {
  /** The tabs' accessible name. */
  readonly label: string;
  readonly tabs: readonly { readonly key: string; readonly href: string; readonly label: string; readonly current: boolean }[];
  /** `tabs` (the default) for a page's sections, on a rule; `chips` for a list's filters, in its toolbar. */
  readonly variant?: 'tabs' | 'chips';
};

/**
 * A page's sections (tabs on a rule) or a list's filters (chips in its toolbar): links, the current one marked in words
 * (`aria-current`) and by a line under it or a fill.
 */
export function Tabs({ label, tabs, variant = 'tabs' }: TabsProps) {
  const chips = variant === 'chips';
  return (
    <nav className={chips ? styles.chips : styles.tabs} aria-label={label}>
      <ul className={chips ? styles.chipList : styles.tabList}>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link className={chips ? styles.chip : styles.tab} href={tab.href} aria-current={tab.current ? 'page' : undefined}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A group of facts or controls under a heading. */
export function Card({ heading, headingId, children }: { readonly heading?: string; readonly headingId?: string; readonly children: ReactNode }) {
  return (
    <section className={styles.card} aria-labelledby={heading === undefined ? undefined : headingId}>
      {heading === undefined ? null : (
        <h2 id={headingId} className={styles.cardHeading}>
          {heading}
        </h2>
      )}
      {children}
    </section>
  );
}

/** An empty list: one sentence saying what belongs here, and the one action that adds the first item. */
export function EmptyState({ icon, text, children }: { readonly icon: IconName; readonly text: string; readonly children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <NamedIcon name={icon} size={24} />
      </span>
      <p className={styles.emptyText}>{text}</p>
      {children}
    </div>
  );
}
