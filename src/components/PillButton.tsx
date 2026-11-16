import type { ButtonHTMLAttributes, Ref } from 'react';

import styles from './PillButton.module.css';

export type PillVariant = 'default' | 'solid' | 'danger';

/** No `style`: the Content-Security-Policy blocks style attributes, so styles come from CSS files. */
export type PillButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  readonly variant?: PillVariant;
  readonly ref?: Ref<HTMLButtonElement>;
};

/**
 * The default button everywhere: a pill in the theme's control colour. `solid` is the single main
 * action of a screen (the theme's text colour as the fill); `danger` confirms a destructive action.
 */
export function PillButton({ variant = 'default', type = 'button', className, ref, ...rest }: PillButtonProps) {
  const classes = [styles.pill, variant === 'default' ? undefined : styles[variant], className].filter(Boolean).join(' ');
  return <button ref={ref} type={type} className={classes} data-variant={variant} {...rest} />;
}

/** At most one per screen, for its main action ("Criar Conta", "Salvar"). */
export function SolidPillButton(props: Omit<PillButtonProps, 'variant'>) {
  return <PillButton {...props} variant="solid" />;
}
