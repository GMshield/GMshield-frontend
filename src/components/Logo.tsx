import styles from './Logo.module.css';

/**
 * GMshield's mark: an open book with a small shield on its spine, drawn in the text colour. Decorative: the
 * name beside it, or the control that holds it, says what it is. Replace this component to change the logo.
 */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <svg className={[styles.mark, className].filter(Boolean).join(' ')} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M16 9.5C12.5 7 7.5 6.6 3.5 8v16.5c4-1.4 9-1 12.5 1.5 3.5-2.5 8.5-2.9 12.5-1.5V8c-4-1.4-9-1-12.5 1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M16 12.5l4 1.4v3.2c0 2.6-1.7 4.3-4 5.2-2.3-.9-4-2.6-4-5.2v-3.2Z" fill="currentColor" />
    </svg>
  );
}

/** The mark beside the name "GMshield". */
export function Logo({ name }: { readonly name: string }) {
  return (
    <span className={styles.logo}>
      <LogoMark />
      <span className={styles.name}>{name}</span>
    </span>
  );
}
