import styles from './Spinner.module.css';

/**
 * A small ring that turns while something the GM started is still running (usability pass, 2026-11-21): inside the
 * button that was pressed, or at the end of the link that was followed. Decorative: the control says in words that it
 * is busy (`aria-busy`, or it is disabled). It never covers the page. Under "reduce motion" it does not turn.
 */
export function Spinner({ size = 16 }: { readonly size?: 14 | 16 | 18 }) {
  return <span className={styles.spinner} data-size={size} aria-hidden="true" />;
}
