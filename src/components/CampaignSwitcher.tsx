'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { CAMPAIGN_ACTION_START, type CampaignActionState } from '@/app/(signed-in)/campaigns/form-state';

import styles from './CampaignSwitcher.module.css';
import { NamedIcon } from './Icons';

/** A campaign the switcher offers: its id, its name and its system's words. */
export type SwitcherCampaign = { readonly id: string; readonly name: string; readonly system: string };

export type CampaignSwitcherLabels = {
  /** The words for no current campaign: the button's text then. */
  readonly none: string;
  /** The spoken name of the opened list, "Trocar de campanha". */
  readonly panel: string;
  /** The spoken name of the list of campaigns. */
  readonly list: string;
  /** "atual": the current campaign, marked in words. */
  readonly current: string;
  /** "Ver todas as mesas". */
  readonly all: string;
  /** "Nova campanha". */
  readonly create: string;
};

export type CampaignSwitcherProps = {
  readonly labels: CampaignSwitcherLabels;
  /** The current campaign, or null when the account has none. */
  readonly current: { readonly id: string; readonly name: string } | null;
  /** The campaigns in use (never an archived one), newest first. */
  readonly campaigns: readonly SwitcherCampaign[];
  /** Under the logo, the list opens below in the sidebar; in the context bar, over the page. */
  readonly placement: 'sidebar' | 'bar';
  readonly action: (previous: CampaignActionState, form: FormData) => Promise<CampaignActionState>;
};

/**
 * The campaign switcher (Story 3.2), under the logo and on the context bar's campaign name: a disclosure button showing
 * the current campaign's name (the pattern `useDisclosure` shares). Open, it lists the campaigns in use with their system, the
 * current one marked in words, then "Ver todas as mesas" and "Nova campanha". Picking one posts it to the Server Action,
 * which makes it current and refreshes the page; the list then closes. A refusal shows as an alert in the list, which
 * stays open. Esc, with focus in the button or the open list, closes it and gives focus back to the button; the key is
 * marked handled, so the sidebar does not also close on it. A press outside it, or moving to another page, closes it.
 */
export function CampaignSwitcher({ labels, current, campaigns, placement, action }: CampaignSwitcherProps) {
  const [state, formAction, pending] = useActionState(action, CAMPAIGN_ACTION_START);
  const pathname = usePathname();
  // Open while no choice has succeeded since it was opened and the page is the one it was opened on: a successful choice
  // or a navigation closes it (the layout, and so this component, stays across pages), a refusal leaves it open.
  const [opened, setOpened] = useState<{ readonly done: number; readonly path: string | null } | null>(null);
  const open = opened !== null && opened.done === state.done && opened.path === pathname;
  const close = () => setOpened(null);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && container.current?.contains(document.activeElement)) {
        event.preventDefault();
        setOpened(null);
        button.current?.focus();
      }
    }
    // A press anywhere outside closes it.
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpened(null);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className={`${styles.switcher} ${placement === 'bar' ? styles.bar : styles.sidebar}`}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpened(open ? null : { done: state.done, path: pathname })}
      >
        <span className={styles.triggerName}>{current?.name ?? labels.none}</span>
        <span className={styles.chevron}>
          <NamedIcon name="chevronDown" size={16} />
        </span>
      </button>
      <div id={id} role="group" aria-label={labels.panel} className={styles.panel} hidden={!open}>
        {campaigns.length === 0 ? null : (
          <ul className={styles.list} aria-label={labels.list}>
            {campaigns.map((campaign) => {
              const isCurrent = campaign.id === current?.id;
              const content = (
                <>
                  <span className={styles.name}>{campaign.name}</span>
                  <span className={styles.system}>{campaign.system}</span>
                  {isCurrent ? (
                    <span className={styles.mark}>
                      <NamedIcon name="check" size={14} />
                      {labels.current}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li key={campaign.id}>
                  {isCurrent ? (
                    <span className={styles.choice} aria-current="true">
                      {content}
                    </span>
                  ) : (
                    <form action={formAction} className={styles.form}>
                      <input type="hidden" name="id" value={campaign.id} />
                      <button
                        type="submit"
                        className={styles.choice}
                        aria-disabled={pending}
                        onClick={(event) => {
                          if (pending) {
                            event.preventDefault();
                          }
                        }}
                      >
                        {content}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {state.error === null ? null : (
          <p role="alert" className={styles.error}>
            {state.error}
          </p>
        )}
        <div className={styles.links}>
          <Link className={styles.link} href="/campaigns" onClick={close}>
            {labels.all}
          </Link>
          <Link className={styles.link} href="/campaigns/new" onClick={close}>
            {labels.create}
          </Link>
        </div>
      </div>
    </div>
  );
}
