'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { Language } from '@/messages';

import { NamedIcon } from './Icons';
import type { Scope } from './scope';
import { ScopeControls, type ScopeControlsProps } from './ScopeControls';
import styles from './ScopePopover.module.css';
import { useScopePopoverRegistry } from './ScopePopoverContext';
import { useDisclosure } from './useDisclosure';

export type ScopePopoverProps = {
  /** "Campanha + Sistema · conhecimento do modelo desligado": the button's text. */
  readonly summary: string;
  /** "Escopo": spoken before the summary ("Escopo: Campanha + Sistema · …"), so the button says what it opens. */
  readonly label: string;
  /** The spoken name of the opened popover, "Escopo da campanha". */
  readonly panel: string;
  readonly campaignId: string;
  readonly scope: Scope;
  readonly language: Language;
  readonly action: ScopeControlsProps['action'];
};

/**
 * The context bar's scope summary and its popover (Story 3.6): a disclosure button showing the summary (the pattern
 * `useDisclosure` shares), which opens the scope controls in a popover anchored under the context bar. The popover
 * floats over the page (it never pushes it), on the opaque popover colour with an edge and no shadow; Esc closes it and
 * gives focus back to the summary, and a press outside it only closes it. Under 768px the summary is not shown: the bar
 * keeps the campaign's name only. The controls stay mounted while it is closed (the panel is only hidden), so a save
 * still running when it closes shows its answer once it opens again; they are keyed by the campaign, so a campaign
 * chosen meanwhile starts them again. Story 3.8: it hands `ScopePopoverProvider` its opener, so the page can open it
 * (the offer under a silent answer); opened that way, focus goes to its first control, and back to what opened it
 * when Esc closes it. Under 768px the summary is not shown, but the popover still opens that way, under the bar.
 */
export function ScopePopover({ summary, label, panel, campaignId, scope, language, action }: ScopePopoverProps) {
  const { open, setOpen, container, button } = useDisclosure();
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Each opening from the page asks for focus inside once it is shown, even when it was open already.
  const [requests, setRequests] = useState(0);
  const focusWanted = useRef(false);
  // What had focus when the page opened it (the offer's button): focus goes back there when it closes.
  const returnTo = useRef<HTMLElement | null>(null);
  const registry = useScopePopoverRegistry();

  useEffect(() => {
    if (registry === null) {
      return undefined;
    }
    registry.register(() => {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusWanted.current = true;
      setOpen(true);
      setRequests((count) => count + 1);
    });
    return () => registry.register(null);
  }, [registry, setOpen]);

  useEffect(() => {
    if (open && focusWanted.current) {
      focusWanted.current = false;
      panelRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    }
  }, [open, requests]);

  useEffect(() => {
    const back = returnTo.current;
    if (open || back === null) {
      return;
    }
    returnTo.current = null;
    // Closed by Esc (focus on the summary, or lost in the hidden panel under 768px), not by a press elsewhere.
    const active = document.activeElement;
    if (active === null || active === document.body || container.current?.contains(active)) {
      back.focus();
    }
  }, [open, container]);

  return (
    <div ref={container} className={styles.popover}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        // Its name holds the words shown (WCAG 2.5.3), after what they summarise.
        aria-label={`${label}: ${summary}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.summary}>{summary}</span>
        <span className={styles.chevron}>
          <NamedIcon name="chevronDown" size={16} />
        </span>
      </button>
      <div ref={panelRef} id={id} role="group" aria-label={panel} className={styles.panel} hidden={!open}>
        <ScopeControls key={campaignId} campaignId={campaignId} scope={scope} language={language} action={action} />
      </div>
    </div>
  );
}
