'use client';

import { useId } from 'react';

import type { Language } from '@/messages';

import { NamedIcon } from './Icons';
import type { Scope } from './scope';
import { ScopeControls, type ScopeControlsProps } from './ScopeControls';
import styles from './ScopePopover.module.css';
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
 * chosen meanwhile starts them again.
 */
export function ScopePopover({ summary, label, panel, campaignId, scope, language, action }: ScopePopoverProps) {
  const { open, setOpen, container, button } = useDisclosure();
  const id = useId();
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
      <div id={id} role="group" aria-label={panel} className={styles.panel} hidden={!open}>
        <ScopeControls key={campaignId} campaignId={campaignId} scope={scope} language={language} action={action} />
      </div>
    </div>
  );
}
