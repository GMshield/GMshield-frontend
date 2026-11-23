import type { ButtonHTMLAttributes, Ref } from 'react';

import styles from './PillButton.module.css';
import { Spinner } from './Spinner';

export type PillVariant = 'default' | 'solid' | 'danger' | 'quiet';

/** No `style`: the Content-Security-Policy blocks style attributes, so styles come from CSS files. */
export type PillButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  readonly variant?: PillVariant;
  readonly ref?: Ref<HTMLButtonElement>;
  /** Whether what it started is still running: it shows a spinner before its text and says it is busy. */
  readonly pending?: boolean;
};

/**
 * The default button everywhere: an outlined pill in the theme's control colour. `solid` is the single main
 * action of a screen (the theme's text colour as the fill); `danger` is a destructive action, outlined in the danger
 * colour (the confirmation dialog fills its own, the last step); `quiet` has no outline, for a row or a toolbar.
 * `pending` (usability pass, 2026-11-21) shows that the action it started has not answered yet; whether it can be
 * pressed meanwhile is still the caller's `disabled` or `aria-disabled`.
 */
export function PillButton({ variant = 'default', type = 'button', className, ref, pending = false, children, ...rest }: PillButtonProps) {
  const classes = [styles.pill, variant === 'default' ? undefined : styles[variant], className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} data-variant={variant} data-pending={pending ? 'true' : undefined} aria-busy={pending || undefined} {...rest}>
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** At most one per screen, for its main action ("Criar Conta", "Salvar"). */
export function SolidPillButton(props: Omit<PillButtonProps, 'variant'>) {
  return <PillButton {...props} variant="solid" />;
}
