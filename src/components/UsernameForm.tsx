'use client';

import { useActionState, useId } from 'react';

import type { UsernameFormState } from '@/app/sign-in/form-state';
import { INITIAL_USERNAME_FORM } from '@/app/sign-in/form-state';
import { translator, type Language } from '@/messages';

import { SolidPillButton } from './PillButton';
import styles from './UsernameForm.module.css';

export type UsernameFormProps = {
  readonly language: Language;
  readonly action: (previous: UsernameFormState, form: FormData) => Promise<UsernameFormState>;
};

/**
 * The username step of a first sign-in: the username, the acceptance of the terms and the privacy notice
 * (both linked), and "Criar conta". A refusal comes back as a message under the field it is about, with
 * what was typed kept. Without JavaScript the form still posts to the Server Action.
 */
export function UsernameForm({ language, action }: UsernameFormProps) {
  const t = translator(language);
  const [state, formAction, pending] = useActionState(action, INITIAL_USERNAME_FORM);
  const id = useId();
  const usernameError = state.field !== 'terms' && state.error !== null;
  const termsError = state.field === 'terms' && state.error !== null;
  return (
    <form action={formAction} className={styles.form} noValidate>
      <div className={styles.field}>
        <label htmlFor={`${id}-username`} className={styles.label}>
          {t('username.label')}
        </label>
        <input
          id={`${id}-username`}
          name="username"
          className={styles.input}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={24}
          defaultValue={state.username}
          aria-invalid={usernameError}
          aria-describedby={usernameError ? `${id}-username-error` : undefined}
        />
        {usernameError ? (
          <p id={`${id}-username-error`} role="alert" className={styles.error}>
            {state.error}
          </p>
        ) : null}
      </div>
      <div className={styles.field}>
        <label className={styles.check}>
          <input
            type="checkbox"
            name="terms"
            value="accepted"
            defaultChecked={state.termsAccepted}
            aria-invalid={termsError}
            aria-describedby={termsError ? `${id}-terms-error` : undefined}
          />
          {t('username.terms')}
        </label>
        <p className={styles.links}>
          <a href="/terms" target="_blank" rel="noopener">
            {t('username.readTerms')}
          </a>
          <a href="/privacy" target="_blank" rel="noopener">
            {t('username.readPrivacy')}
          </a>
        </p>
        {termsError ? (
          <p id={`${id}-terms-error`} role="alert" className={styles.error}>
            {state.error}
          </p>
        ) : null}
      </div>
      <SolidPillButton type="submit" disabled={pending}>
        {t('username.submit')}
      </SolidPillButton>
    </form>
  );
}
