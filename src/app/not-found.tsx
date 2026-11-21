import { notFound } from 'next/navigation';

import { PillLink } from '@/components/PillLink';
import { problemFields, translator } from '@/messages';
import { currentPreferences } from '@/preferences';

import styles from './page.module.css';

/**
 * The single not-found page, for unknown routes and for anything a backend answer says is not
 * there or not this visitor's. It says nothing about what exists.
 */
export default async function NotFound() {
  const t = translator((await currentPreferences()).language);
  return (
    <main className={styles.main}>
      <div className={styles.entry}>
        <div className={styles.card}>
          <h1 className={styles.heading}>{t('notFound.title')}</h1>
          <p className={styles.actions}>
            <PillLink href="/" solid>
              {t('notFound.home')}
            </PillLink>
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * Renders the not-found page for a backend problem `request.not_found`, any 404 or any 403, so a
 * request for another owner's item looks exactly like one for an item that does not exist.
 * Otherwise returns.
 */
export function notFoundFor(problem: unknown): void {
  const { status, code } = problemFields(problem);
  if (code === 'request.not_found' || status === 404 || status === 403) {
    notFound();
  }
}
