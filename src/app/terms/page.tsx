import type { Metadata } from 'next';
import Link from 'next/link';

import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';

import legal from '../legal.module.css';
import styles from '../page.module.css';

const PARAGRAPHS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator((await currentPreferences()).language)('legal.terms.title') };
}

/** The draft terms of use (Story 1.9), marked "Rascunho / Draft"; Epic 10 replaces it with the reviewed text. */
export default async function TermsPage() {
  const t = translator((await currentPreferences()).language);
  return (
    <main className={styles.main}>
      <p className={legal.draft}>{t('legal.draft')}</p>
      <h1 className={styles.heading}>{t('legal.terms.title')}</h1>
      <p className={styles.lead}>{t('legal.draftNote')}</p>
      {PARAGRAPHS.map((paragraph) => (
        <p key={paragraph} className={legal.paragraph}>
          {t(`legal.terms.${paragraph}`)}
        </p>
      ))}
      <Link className={styles.link} href="/">
        {t('legal.home')}
      </Link>
    </main>
  );
}
