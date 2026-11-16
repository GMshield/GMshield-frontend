import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Notice } from '@/components/Notice';
import { PillButton, SolidPillButton } from '@/components/PillButton';
import { PreferencesForm } from '@/components/PreferencesForm';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences, type Preferences } from '@/preferences';
import { currentAccount } from '@/server/accounts';
import { currentSessionToken, endedPath, renewPath } from '@/server/session-cookies';

import styles from './page.module.css';
import { signOutAction } from './sign-in/actions';
import { signInNoticeFor, signInNoticeFrom, type SignInNotice } from './sign-in/notice';

type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

/** This page's path, where an ended or renewed session comes back to. */
const HOME = '/';

/**
 * `/` until Story 1.11 replaces it. Signed out, the sign-in screen: "Continuar com Google" and the
 * preferences form. Signed in, "Olá, <username>", the preferences form and "Sair". A sign-in outcome that
 * a redirect put in `?signIn=` is shown only when it is one of the known codes.
 */
export default async function HomePage({ searchParams }: { readonly searchParams?: SearchParams } = {}) {
  const preferences = await currentPreferences();
  const query = (await searchParams) ?? {};
  let notice: SignInNotice | null = signInNoticeFrom(query.signIn);
  const token = await currentSessionToken();
  if (token !== null) {
    const account = await currentAccount(token);
    if (account.ok) {
      return <SignedIn username={account.data.username} preferences={preferences} />;
    }
    const { code } = problemFields(account.problem);
    if (code === 'session.required') {
      // An ended session: the stale cookie goes, then the sign-in screen says so once, and comes back here.
      redirect(endedPath(HOME));
    }
    if (code === 'session.renewal_required') {
      // The account's seal version rose (Story 1.10): renew the token, then load this page again.
      redirect(renewPath(HOME));
    }
    // Any other failure says what happened.
    notice = signInNoticeFor(code);
  }
  return <SignInScreen preferences={preferences} notice={notice} />;
}

function SignedIn({ username, preferences }: { readonly username: string; readonly preferences: Preferences }) {
  const t = translator(preferences.language);
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>{t('home.greeting', { username })}</h1>
      <p className={styles.lead}>{t('home.signedInLead')}</p>
      <PreferencesForm theme={preferences.theme} language={preferences.language} />
      <form action={signOutAction} className={styles.signOut}>
        <PillButton type="submit">{t('home.signOut')}</PillButton>
      </form>
    </main>
  );
}

function SignInScreen({ preferences, notice }: { readonly preferences: Preferences; readonly notice: SignInNotice | null }) {
  const t = translator(preferences.language);
  return (
    <main className={styles.main}>
      {notice === null ? null : <SignInNoticeLine notice={notice} language={preferences.language} />}
      <h1 className={styles.heading}>{t('home.heading')}</h1>
      <p className={styles.lead}>{t('home.lead')}</p>
      {/* A plain post answered with a 303: the browser always navigates in full to Google. */}
      <form method="post" action="/sign-in/google" className={styles.signIn} aria-label={t('signIn.title')}>
        <SolidPillButton type="submit">{t('signIn.google')}</SolidPillButton>
        <p className={styles.legal}>
          {t('signIn.legal')}{' '}
          <Link className={styles.inlineLink} href="/terms">
            {t('signIn.terms')}
          </Link>
          {' · '}
          <Link className={styles.inlineLink} href="/privacy">
            {t('signIn.privacy')}
          </Link>
        </p>
      </form>
      <PreferencesForm theme={preferences.theme} language={preferences.language} />
    </main>
  );
}

function SignInNoticeLine({ notice, language }: { readonly notice: SignInNotice; readonly language: Language }) {
  const [category] = notice.split('.');
  return <Notice status="danger" language={language} message={errorText({ category, code: notice }, language)} />;
}
