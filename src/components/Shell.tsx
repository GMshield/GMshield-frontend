import type { ReactNode } from 'react';

import { signOutAction } from '@/app/sign-in/actions';
import { translator } from '@/messages';
import type { Preferences } from '@/preferences';
import type { SidebarState } from '@/sidebar-cookie';

import { ContextBar } from './ContextBar';
import { PillButton } from './PillButton';
import { PreferencesForm } from './PreferencesForm';
import styles from './Shell.module.css';
import { ADD_FILE, SIDEBAR_ENTRIES, type EntryKey } from './shell-entries';
import { Sidebar } from './Sidebar';
import type { Belonging, Material } from './uploads/types';
import { uploadTexts } from './uploads/upload-texts';
import { UploadsProvider } from './uploads/UploadsProvider';

export type ShellProps = {
  readonly preferences: Preferences;
  readonly username: string;
  /** The current campaign and its system, or null when the account has none. */
  readonly current: { readonly system: string; readonly campaign: string } | null;
  readonly sidebar: SidebarState;
  /** A line at the top of the main column, such as a failure to load the current campaign. */
  readonly notice?: ReactNode;
  /** The right panel, when one is open: it narrows the main column. None yet. */
  readonly panel?: ReactNode;
  /** The current campaign and its system with their ids, which the guided upload offers (Story 1.14). */
  readonly belonging?: Belonging;
  /** The upload tray's rows from the server (Story 1.14). */
  readonly trayRows?: readonly Material[];
  readonly children: ReactNode;
};

/**
 * The signed-in shell (Story 1.11): the sidebar, the context bar and the main column, in that order in the page
 * (and so in Tab order), and room for one right panel. The main column is centred and never wider than the
 * reading width. Around it, the uploads of this tab (Story 1.14), which go on while the GM moves inside the app.
 */
export function Shell({ preferences, username, current, sidebar, notice, panel, belonging = null, trayRows = [], children }: ShellProps) {
  const t = translator(preferences.language);
  const entries = Object.fromEntries(
    [...SIDEBAR_ENTRIES, ADD_FILE].map(({ key }) => [key, t(`shell.entries.${key}`)]),
  ) as Record<EntryKey, string>;
  return (
    <UploadsProvider texts={uploadTexts(preferences.language)} belonging={belonging}>
      <div className={styles.shell} data-panel={panel === undefined ? 'none' : 'open'}>
        <Sidebar
          labels={{
            name: t('shell.name'),
            menu: t('shell.menu'),
            openMenu: t('shell.openMenu'),
            closeMenu: t('shell.closeMenu'),
            navigation: t('shell.navigation'),
            currentCampaign: t('shell.currentCampaign'),
            entries,
          }}
          campaign={current?.campaign ?? t('shell.noCampaign')}
          initialState={sidebar}
          trayRows={trayRows}
          menu={
            <>
              <p className={styles.signedInAs}>{t('shell.signedInAs', { username })}</p>
              <PreferencesForm theme={preferences.theme} language={preferences.language} />
              <form action={signOutAction}>
                <PillButton type="submit">{t('shell.signOut')}</PillButton>
              </form>
            </>
          }
        />
        <div className={styles.column} data-behind-sidebar="">
          <ContextBar label={t('shell.context')} current={current} none={t('shell.noCampaign')} />
          <main className={styles.main}>
            {notice}
            {children}
          </main>
        </div>
        {panel === undefined ? null : (
          <aside className={styles.panel} data-behind-sidebar="">
            {panel}
          </aside>
        )}
      </div>
    </UploadsProvider>
  );
}
