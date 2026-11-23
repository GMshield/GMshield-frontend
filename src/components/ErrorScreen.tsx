'use client';

import { useSyncExternalStore } from 'react';

import { DEFAULT_LANGUAGE, LANGUAGES, translator, type Language } from '@/messages';

import styles from './ErrorScreen.module.css';
import { NamedIcon } from './Icons';
import { PillButton } from './PillButton';
import { PillLink } from './PillLink';

/** The page's language, as the server declared it on `<html lang>`; the default while the server renders. */
function pageLanguage(): Language {
  return LANGUAGES.find((language) => language === document.documentElement.lang) ?? DEFAULT_LANGUAGE;
}

/**
 * What a page shows when it could not be built (usability pass, 2026-11-21): an unexpected failure used to end in the
 * framework's own bare page, in English. This says in the interface's language that the page could not be shown and
 * what to do next ("Tentar de novo" builds it again; "Ir para o início" leaves), never a code or a stack. It is the
 * body of `error.tsx` at the root and inside the signed-in shell, where the sidebar and the bar stay in place.
 */
export function ErrorScreen({ retry }: { readonly retry: () => void }) {
  const language = useSyncExternalStore(
    () => () => undefined,
    pageLanguage,
    () => DEFAULT_LANGUAGE,
  );
  const t = translator(language);
  return (
    <div className={styles.screen} role="alert">
      <span className={styles.icon}>
        <NamedIcon name="error" size={28} />
      </span>
      <h1 className={styles.title}>{t('errorPage.title')}</h1>
      <p className={styles.text}>{t('errorPage.lead')}</p>
      <div className={styles.actions}>
        <PillButton variant="solid" onClick={() => retry()}>
          {t('errorPage.retry')}
        </PillButton>
        <PillLink href="/">{t('errorPage.home')}</PillLink>
      </div>
    </div>
  );
}
