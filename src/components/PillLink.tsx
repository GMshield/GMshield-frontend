import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './PillButton.module.css';

/**
 * A link that looks like a pill (Story 3.1): "Novo sistema", "Editar", "Cancelar". `solid` is the single main action of a
 * screen, as for `SolidPillButton`. No `style` attribute: the classes come from the pill's CSS file.
 */
export function PillLink({
  href,
  solid = false,
  children,
}: {
  readonly href: string;
  readonly solid?: boolean;
  readonly children: ReactNode;
}) {
  const classes = [styles.pill, solid ? styles.solid : undefined].filter(Boolean).join(' ');
  return (
    <Link href={href} className={classes} data-variant={solid ? 'solid' : 'default'}>
      {children}
    </Link>
  );
}
