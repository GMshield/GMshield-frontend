import { redirect } from 'next/navigation';

import { UsernameForm } from '@/components/UsernameForm';
import { translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { currentSignInToken } from '@/server/session-cookies';

import styles from '../../page.module.css';
import { completeSignInAction } from '../actions';
import { homeWithNotice } from '../notice';

/** The username step of a first sign-in. Without a sign-in attempt cookie, back to the sign-in screen. */
export default async function UsernamePage() {
  if ((await currentSignInToken()) === null) {
    redirect(homeWithNotice('request.sign_in_expired'));
  }
  const { language } = await currentPreferences();
  const t = translator(language);
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>{t('username.title')}</h1>
      <p className={styles.lead}>{t('username.lead')}</p>
      <UsernameForm language={language} action={completeSignInAction} />
    </main>
  );
}
