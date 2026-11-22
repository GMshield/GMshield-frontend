import type { ReactNode } from 'react';

import { changeScopeAction, chooseCampaignAction } from '@/app/(signed-in)/campaigns/actions';
import { createImageSetAction, dropSetImageAction, replaceSetImageAction } from '@/app/(signed-in)/image-set-actions';
import { signOutAction } from '@/app/sign-in/actions';
import { translator } from '@/messages';
import type { Preferences } from '@/preferences';
import type { SidebarState } from '@/sidebar-cookie';

import { AccountMenu } from './AccountMenu';
import accountStyles from './AccountMenu.module.css';
import { CampaignSwitcher, type CampaignSwitcherLabels, type SwitcherCampaign } from './CampaignSwitcher';
import { ContextBar } from './ContextBar';
import { NamedIcon } from './Icons';
import { NotificationCenter } from './notifications/NotificationCenter';
import { NotificationsProvider, type NotificationInput } from './notifications/NotificationsProvider';
import { PillButton } from './PillButton';
import { PreferencesForm } from './PreferencesForm';
import { scopeSummary, type Scope } from './scope';
import { ScopePopover } from './ScopePopover';
import { ScopePopoverProvider } from './ScopePopoverContext';
import styles from './Shell.module.css';
import { ShellFrame } from './ShellPanel';
import { ADD_FILE, SIDEBAR_ENTRIES, type EntryKey } from './shell-entries';
import { Sidebar } from './Sidebar';
import { NO_PLACES, type Belonging, type Material } from './uploads/types';
import { uploadTexts } from './uploads/upload-texts';
import { UploadsProvider } from './uploads/UploadsProvider';

export type ShellProps = {
  readonly preferences: Preferences;
  readonly username: string;
  /** The current campaign (its id from Story 3.2) and its system, or null when the account has none. */
  readonly current: { readonly id?: string; readonly system: string; readonly campaign: string } | null;
  /** The campaigns in use the switcher offers (Story 3.2), newest first. */
  readonly campaigns?: readonly SwitcherCampaign[];
  /**
   * The current campaign's scope settings (Story 3.6), for the context bar's summary and its popover; null (no summary)
   * when there is no campaign or they could not be read.
   */
  readonly scope?: Scope | null;
  readonly sidebar: SidebarState;
  /**
   * Lines at the top of the main column, one each, in the order given, such as a failure to load the current campaign.
   * Each element carries its own `key`.
   */
  readonly notices?: readonly ReactNode[];
  /**
   * What waits for the GM now (usability pass, 2026-11-21): the materials that need review or failed, listed first under
   * the bell and counted on it.
   */
  readonly attention?: readonly (NotificationInput & { readonly id: string })[];
  /**
   * A right panel rendered on the server, when one is open: it narrows the main column. From Story 2.7 the source view
   * fills the same slot from the browser (`ShellPanel`).
   */
  readonly panel?: ReactNode;
  /**
   * What the guided upload's "where it belongs" offers (Story 1.14; from Story 3.3 every campaign in use, every system
   * and the current campaign).
   */
  readonly belonging?: Belonging;
  /** The upload tray's rows from the server (Story 1.14). */
  readonly trayRows?: readonly Material[];
  readonly children: ReactNode;
};

/** The image set calls of the guided upload and the tray (Story 1.21): Server Actions. */
const IMAGE_SETS = { create: createImageSetAction, replace: replaceSetImageAction, drop: dropSetImageAction };

/**
 * The signed-in shell (Story 1.11): the sidebar, the context bar and the main column, in that order in the page
 * (and so in Tab order), and room for one right panel. The main column is centred and never wider than the
 * reading width. Around it, the uploads of this tab (Story 1.14), which go on while the GM moves inside the app.
 * Story 2.7: the grid and its panel slot are `ShellFrame`'s, which a page's source view fills from the browser.
 * Story 3.2: the campaign switcher under the logo and on the context bar's campaign name; picking a campaign makes it
 * current through a Server Action, which refreshes the page.
 * Usability pass (2026-11-21): the notifications are around everything (their toasts are told from any page and from
 * the uploads), and the bar above the page holds the system and campaign on the left and, on the right, the bell and
 * the account menu (the account, the theme and the language, "Sair").
 * Story 3.6: after the campaign, the context bar holds its scope summary, which opens the scope popover; each switch
 * there saves through a Server Action that renders the layout again, so the summary follows.
 */
export function Shell({
  preferences,
  username,
  current,
  campaigns = [],
  scope = null,
  sidebar,
  notices = [],
  attention = [],
  panel,
  belonging = NO_PLACES,
  trayRows = [],
  children,
}: ShellProps) {
  const t = translator(preferences.language);
  const switcherLabels: CampaignSwitcherLabels = {
    none: t('shell.noCampaign'),
    panel: t('shell.switchCampaign'),
    list: t('shell.campaignChoices'),
    current: t('shell.currentMark'),
    all: t('shell.allCampaigns'),
    create: t('shell.newCampaign'),
  };
  const switcher = (placement: 'sidebar' | 'bar') => (
    <CampaignSwitcher
      labels={switcherLabels}
      current={current === null ? null : { id: current.id ?? '', name: current.campaign }}
      campaigns={campaigns}
      placement={placement}
      action={chooseCampaignAction}
    />
  );
  const scopePopover =
    current?.id === undefined || current.id === '' || scope === null ? null : (
      <ScopePopover
        summary={scopeSummary(scope, t)}
        label={t('shell.scope.label')}
        panel={t('shell.scope.panel')}
        campaignId={current.id}
        scope={scope}
        language={preferences.language}
        action={changeScopeAction}
      />
    );
  const entries = Object.fromEntries(
    [...SIDEBAR_ENTRIES, ADD_FILE].map(({ key }) => [key, t(`shell.entries.${key}`)]),
  ) as Record<EntryKey, string>;
  return (
    <NotificationsProvider language={preferences.language}>
      <UploadsProvider texts={uploadTexts(preferences.language)} belonging={belonging} imageSets={IMAGE_SETS}>
        <ScopePopoverProvider>
          {/* The first stop of the keyboard: past the sidebar and the bar, straight to the page (WCAG 2.4.1). */}
          <a className={styles.skip} href="#content">
            {t('shell.skip')}
          </a>
          <ShellFrame panel={panel}>
            <Sidebar
              labels={{
                name: t('shell.name'),
                home: t('shell.home'),
                openMenu: t('shell.openMenu'),
                closeMenu: t('shell.closeMenu'),
                navigation: t('shell.navigation'),
                currentCampaign: t('shell.currentCampaign'),
                entries,
              }}
              campaign={switcher('sidebar')}
              initialState={sidebar}
              trayRows={trayRows}
            />
            <div className={styles.column} data-behind-sidebar="" data-behind-panel="">
              <div className={styles.bar}>
                <ContextBar label={t('shell.context')} current={current} none={t('shell.noCampaign')} switcher={switcher('bar')} scope={scopePopover} />
                <div className={styles.barEnd}>
                  <NotificationCenter language={preferences.language} attention={attention} />
                  <AccountMenu username={username} label={t('shell.account', { username })} title={t('shell.accountMenu')}>
                    <p className={accountStyles.account}>
                      <span className={accountStyles.accountLabel}>{t('shell.signedInLabel')}</span>
                      <span className={accountStyles.accountName}>{username}</span>
                    </p>
                    <PreferencesForm theme={preferences.theme} language={preferences.language} />
                    <form action={signOutAction} className={accountStyles.signOut}>
                      <PillButton type="submit">
                        <NamedIcon name="signOut" size={18} />
                        {t('shell.signOut')}
                      </PillButton>
                    </form>
                  </AccountMenu>
                </div>
              </div>
              <main id="content" className={styles.main}>
                {notices}
                {children}
              </main>
            </div>
          </ShellFrame>
        </ScopePopoverProvider>
      </UploadsProvider>
    </NotificationsProvider>
  );
}
